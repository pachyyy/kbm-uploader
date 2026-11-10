# State machines

Every piece of this app that moves through named stages is listed here, with its
states, its allowed moves, and where the rules live. **Read the relevant section
before changing the flow it describes**, and update it in the same change.

Why this matters here: the app writes to a real government database, and a
duplicate record is worse than a visible failure. Most of the rules below exist to
keep "I don't know whether SIDIA stored it" from being mistaken for "it failed".

Conventions for the machines in `lib/machines/`:

- Pure functions only — no `fetch`, timers or React. Effects live in a driver
  (`hooks/use-draft-run.ts`) or the component that owns the machine.
- A state is a discriminated union, so an impossible combination does not typecheck.
- A reducer given an **illegal event returns the identical state object** (`===`).
  Illegal moves are ignored, never trusted. The tests assert this.
- Tests: `npm test` (vitest). Every transition below is covered in
  `lib/machines/*.test.ts`; storeEntry's response classification in
  `lib/sidia/submit.test.ts`.

---

## 1. Draft run — `lib/machines/draft-run.ts`, driven by `hooks/use-draft-run.ts`

Saves every ready teacher to SIDIA as a draft, serially, one request each.

### Run phase

| From | Event | To | Notes |
|---|---|---|---|
| `idle` | `started` | `checking` | Keeps results only if `tanggal` is unchanged; a new date starts empty |
| `checking` | `planned` | `drafting` | Carries the plan from `planRun` |
| `checking` | `checkFailed` | `idle` | Sets `error`; **nothing was written** |
| `drafting` | `teacherStarted` / `teacherFinished` / `waiting` / `waitEnded` | `drafting` | See per-teacher table |
| `drafting` | `draftingDone` | `refreshing` | Send button stays "checking" until SIDIA is re-read |
| `refreshing` | `refreshed` | `idle` | |
| any non-idle | `aborted` | `idle` | In-flight teacher becomes `unconfirmed`; sets `error` |

`isRunLocked` is true in every phase except `idle`: the date picker, class text and
photo slots are disabled for the whole run, so what is shown is what is uploaded.
A `beforeunload` prompt is active while locked.

### Per-teacher status (`DraftStatus`)

| Status | Meaning | Retry may touch it? |
|---|---|---|
| `pending` | Queued | yes |
| `in_progress` | Request in flight | — |
| `drafted` | SIDIA stored it | **no** (terminal) |
| `unconfirmed` | The request never gave a trustworthy answer, so SIDIA may have stored it | **no** (terminal) |
| `failed` | SIDIA refused it; nothing was created | yes → `pending` on the next run |
| `already_exists` | SIDIA already holds an entry for this teacher and date; skipped | **no** (terminal). Client-only: `/api/draft` never returns it |

Moves: `pending → in_progress → drafted | unconfirmed | failed`.
`already_exists` is assigned at planning time (`planRun`), never mid-run.

**Never label `unconfirmed` as "failed"** — failed invites a retry that can duplicate a record.

### Results belong to one date

`DraftRunState.tanggal` tags the date the results were produced for. Read them
through `resultsForDate(state, pickedDate)`; they are empty for any other date.
Without the tag, last Sunday's `drafted` teachers were skipped on this Sunday's run.

### Duplicate guard (`planRun`, before any write)

The driver reads every entry SIDIA holds for the date (`GET /api/entries?tanggal=`)
and `findExisting` matches teachers to them **by normalized name** (the table
exposes no `pendidik_id`). If the read fails, the run **fails closed** (`checkFailed`)
and writes nothing. A name that matches nothing is simply not reported — the guard
can fail to help but cannot block a teacher who has no entry.

| Previous status | SIDIA has an entry | Result |
|---|---|---|
| none / `failed` | yes | `already_exists` |
| none / `failed` | no | `pending` |
| `drafted` | either | stays `drafted` |
| `unconfirmed` | yes | `already_exists` ("Confirmed") |
| `unconfirmed` | no | **stays `unconfirmed`** — SIDIA's list can lag a fresh write, so absence proves nothing |
| `already_exists` | either | stays |

### What the server answers (`POST /api/draft`)

`storeEntry` (`lib/sidia/submit.ts`) is total once the POST has been sent: it never
throws, so the route can classify honestly.

| What happened | Outcome | `status` |
|---|---|---|
| 302 away from the form | ok | `drafted` |
| 302 back to `/jadwal/create`, a 200 re-rendering errors, 4xx | `rejected` | `failed` |
| Login page in reply | `session_expired` | replayed once by `withSession` |
| POST sent, connection dropped / timed out | `unconfirmed` | `unconfirmed` |
| SIDIA 5xx | `unconfirmed` | `unconfirmed` (it may have crashed after writing) |
| Error before the POST (login, form scrape) | exception | `failed` (nothing was sent) |

On the client, `interpretDraftResponse` maps anything unrecognised (non-JSON,
unexpected shape, a gateway timeout) to `unconfirmed`; only the login gate's 401
is `failed`, because it never reached SIDIA.

---

## 2. Send flow — `lib/machines/send-flow.ts`, used by `components/send-to-penyuluh.tsx`

Shared by the upload page and the Riwayat modal. Finalizing cannot be undone.

| From | Event | To |
|---|---|---|
| `idle` | `open` | `confirming` (error cleared) |
| `confirming` | `cancel` | `idle` |
| `confirming` | `confirm` | `sending` |
| `sending` | `succeeded` | `idle` |
| `sending` | `failed` | `confirming` (carries the error; can retry) |

The dialog is open exactly when not `idle`. `cancel` while `sending` is illegal, so
Escape / outside-click cannot dismiss a request in flight. `/api/send` re-reads the
drafts for the date from SIDIA, so a stale page can never send an old uuid.

## 3. Photo slot — `lib/machines/photo-slot.ts`, used by `components/photo-slot.tsx`

`empty → working → done | error`; `picked` is accepted from any state; `removed`
empties a `done` or `error` slot.

Every pick carries a `token`; a result is accepted only if its token matches the
current `working` pick. A slow compression of an earlier file therefore cannot
overwrite a later pick or leak its preview URL. On `picked`, the component also
tells the parent the photo is gone (`onCompressed(null)`), so a run can never upload
the previous photo while the slot says "Compressing…".

## 4. Upload page phase — `lib/machines/upload-phase.ts`

Derived, not stored: `loading → load_error` (fetch failed, nothing cached) ·
`loading → needs_mapping → ready` (every teacher assigned). A load error is not
shown over teachers that are already on screen.

---

## Machines that exist but are not (yet) reducers

Documented so nobody has to rediscover them. Behaviour here is unchanged.

**SIDIA session** (`lib/sidia/session.ts`): `none → live → expired → relogin`, held in
one module-level variable. `withSession` retries once, and only when the error
message is `SIDIA_SESSION_EXPIRED`. *Known gaps:* expiry is detected inconsistently —
`fetchCreateFormContext` throws a plain error on a non-200 (not recognised as expiry),
`fetchEntries` has no expiry check at all (history, drafts, entries and send would
fail rather than re-login), and `finalizeEntry` treats any 302 as success without
checking where it points. These depend on how SIDIA actually behaves when a session
dies and could not be verified without it. Two concurrent requests can also both
re-login.

**Drafts-for-date resource** (`draftState` in `app/page.tsx`): `unknown → ready | error`,
always tagged with its date. Already handled correctly.

**Teacher load** (`app/page.tsx`, `components/teacher-mapping.tsx`): `cache → live`,
with the same fetch logic copy-pasted in both files. *Known gaps:* if the live fetch
fails, the cached teacher list is used silently (a stale `pendidik_id` would file a
report under the wrong teacher); `setKelompok` runs its toast, storage write and
`onComplete` inside a `setState` updater, so React StrictMode fires them twice in dev.

**Auth** (`proxy.ts`, `app/login/page.tsx`): the cookie lasts 30 days; a 401 mid-session
is shown as "Server returned 401" rather than redirecting to login.

**Navigation during a run:** `beforeunload` covers closing the tab, not client-side
navigation. Leaving the page mid-run lets the loop keep submitting while its results
are lost with the unmounted page.
