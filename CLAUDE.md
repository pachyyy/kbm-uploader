# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev      # dev server on :3000
npm run build    # production build (also the only type-check gate — tsc runs here)
npm run start    # serve the production build
npm run lint     # eslint (flat config, eslint-config-next)
```

There is no test suite. Verification is manual: run `npm run dev`, log in with `APP_PASSWORD`, and exercise the flow against SIDIA.

`.env.local` (see `.env.local.example`) must define all three:
- `SIDIA_USERNAME` / `SIDIA_PASSWORD` — the shared SIDIA account this app submits as
- `APP_PASSWORD` — gates the app itself; [proxy.ts](proxy.ts) returns 500 for every request if unset

## What this app is

A single-purpose uploader for **SIDIA** (`dispendik.surabaya.go.id/sidia`), a Surabaya government Laravel app for weekly Sunday-school KBM (teaching activity) reports. SIDIA has no API — this app **drives its HTML forms with `fetch` + cheerio**, logged in as one shared account. The value it adds is batching: ~15 teachers who share the same date and per-class text, submitted one at a time from one screen instead of 15 manual form fills.

Because it writes to a real government database, **a duplicate record is worse than a visible failure.** This constraint shapes the error model throughout — see "Draft statuses" below.

## Architecture

### The SIDIA client (`lib/sidia/`)

Everything that touches SIDIA lives here and is server-only.

- **`config.ts`** — every SIDIA URL, in one place. Note `loginPage` (GET-only) vs `loginSubmit` (`/log/in`, the form's real action).
- **`session.ts`** — login, cookie jar, CSRF scraping. Session is cached at **module scope** so warm serverless invocations skip re-login. Two things are non-negotiable:
  - Every request sends a browser `USER_AGENT`; SIDIA 500s without one.
  - `fetchCreateFormContext()` must be called **before every** store/finalize — Laravel's CSRF token is stateful and cannot be reused from login. It also scrapes the pre-filled identity fields (`npsn`, `nama`, `kecamatan`), which the store controller 500s without.
- **`submit.ts`** — the two writes: `storeEntry` (create draft) and `finalizeEntry` (send to penyuluh).
- **`entries.ts`** — reads records back out of `ajax_index`, and the only place that query lives. `fetchEntries` (all), `fetchDrafts` (one date, still draft), `groupByDate`.
- **`teachers.ts`** — live teacher list scraped from `<select name="pendidik_id">`. `KNOWN_TEACHERS` is a stale fallback only; never prefer it over a live fetch (a wrong `pendidik_id` files a report under the wrong teacher).

### The two-step submit

SIDIA requires two calls per record, and they are **two separate user actions**, not one flow:

1. `POST /kbm/jadwal/store` — creates the record as a **draft**. Responds with a 302 and no id. Driven by `POST /api/draft`, one teacher per request.
2. `GET /kbm/jadwal/kirim_ke_penyuluh?uuid=…` — finalizes a draft so the penyuluh sees it. Driven by `POST /api/send`, which takes a **date, not a list of uuids**.

Keeping them separate is what makes the flow safe. `/api/send` re-reads the drafts for that date from SIDIA at send time, so the client can never send a uuid that already went out or miss one drafted elsewhere — and because step 2 gets its uuids from `ajax_index`, step 1 never needs to identify the row it just created. Do not reintroduce a "find the record I just stored" lookup: `/store` returns no id, `ajax_index` doesn't sort newest-first, and its searchable date column is a formatted string (`"Minggu<br>02 Agt 2026"`) that a raw `yyyy-mm-dd` query never matches. That lookup was inherently racy and is why an "exists but unconfirmed" state used to be necessary.

Interpreting the store response: a 302 **back to `/jadwal/create`** means validation failed and nothing was created; only a redirect *away* from the form is a success.

`fetchEntries` pulls with `length=-1` for the same sort-order reason — any fixed window is an arbitrary slice, which would show partial dates once grouped. Filtering happens in JS on the full set.

### Draft statuses (`DraftStatus` in `lib/types.ts`)

The split matters — it decides whether the UI invites a retry that would duplicate a government record:

- `drafted` — stored. Terminal; excluded from any retry run.
- `unconfirmed` — the request never came back (network drop, timeout), so whether SIDIA stored it is genuinely unknown. Also terminal for retry purposes; resolved by checking Riwayat for the date. **Never label this "failed".**
- `failed` — SIDIA actively rejected it and created nothing. Safe to retry.

### Session-expiry retry pattern

Every SIDIA-backed route wraps its work in **`withSession()`** ([lib/sidia/session.ts](lib/sidia/session.ts)): run once → on expiry `invalidateSession()` → run once more → a second expiry propagates. The callback must be safe to run twice. Signal expiry by throwing `SessionExpiredError` (or any Error whose message is `"SIDIA_SESSION_EXPIRED"` — `fetchTeachers` and `fetchCreateFormContext` use the string form).

`/api/send` deliberately opts out past its first success: re-running the loop after some entries have already been finalized would re-send them, so it degrades to a per-entry failure telling the user to click Send again.

### Client side

- **`lib/compress.ts`** runs in the browser (canvas + `createImageBitmap`), resizing to 1600px and stepping JPEG quality down until under 450 KB — headroom under SIDIA's hard 512 KB / jpeg,jpg,png server limit. HEIC is rejected up front with a user-actionable message since browsers can't decode it.
- **`app/page.tsx`** drafts **serially, one teacher per `/api/draft` request** (`maxDuration = 60`). Don't batch multiple teachers into one request or parallelize — a timeout mid-batch produces exactly the ambiguous state the status model is trying to avoid.
- **Draft state is always tagged with the date it was read for** (`draftState.tanggal` in `app/page.tsx`), and treated as unknown when the tag doesn't match the picked date. Without that, switching dates mid-request lets a slow response paint one date's drafts under another — and the send button acts on whatever it is showing.
- **`components/send-to-penyuluh.tsx`** is shared by the upload page and the Riwayat modal. It always confirms before sending, because finalizing is outward-facing and this app cannot undo it.
- **`lib/dates.ts`** owns the date rules. `tanggal` defaults to `sundayOfWeek(new Date())` — the Sunday just passed, or today when today is a Sunday — and the picker ([components/date-picker.tsx](components/date-picker.tsx)) disables every non-Sunday and every future day, since a KBM report can only describe a Sunday class that already happened. Always format with `toYmd()`; `toISOString()` would shift the day for WIB (UTC+7) users and file the report under the wrong Sunday.
- **`app/riwayat/page.tsx`** is the review surface: `GET /api/history` returns entries already grouped by date (newest first, capped to `MAX_DATES`), and each date opens a modal listing its entries plus a send action for whatever is still draft.
- **`lib/storage.ts`** persists the teacher→kelompok mapping, cached teacher list, and last week's per-class text in `localStorage` under versioned `kbm.*.v1` keys. localStorage is read **in a `useEffect`, never a lazy `useState` initializer** — the server render has no localStorage, so the latter causes a hydration mismatch. Preserve this pattern.

### Auth

`proxy.ts` (Next 16's renamed `middleware.ts`) gates every route except `/login` and `/api/auth` behind an HMAC cookie signed with `APP_PASSWORD` (`lib/auth.ts`). API routes get a 401; pages redirect to `/login?next=…`. It's an in-app login page rather than Basic Auth specifically so users don't confuse this app's password with the separate SIDIA one.

## UI conventions

shadcn components here are the **`base-nova` style built on `@base-ui/react`, not Radix**. Consequences when writing or adding components:

- Composition uses the **`render` prop**, not `asChild`: `<Button render={<Link href="/teachers" />}>`.
- Prop types come from the primitive namespace (`DialogPrimitive.Root.Props`), not `React.ComponentProps<typeof …>`.
- Tailwind v4, configured entirely in `app/globals.css` — there is no `tailwind.config`.

The one exception is `components/ui/calendar.tsx`, which wraps **react-day-picker v10** (+ date-fns v4) rather than a base-ui primitive — v10's API differs from the v8/v9 examples that are most common online.

`components/layout-shell.tsx` picks the chrome per route: `/login` renders bare, everything else gets `AppShell` (sidebar).

## Domain vocabulary

Indonesian field names are kept verbatim from SIDIA and should not be translated in code: `tanggal` (date), `pendidik_id` (teacher id), `kelompok` (class group), `jenis_pembelajaran` (lesson type), `materi` (material), `catatan` (notes), `foto1..3`, `penyuluh` (supervisor who verifies), `riwayat` (history). The five `kelompok` values are fixed in `KELOMPOK_LIST`.

## Notes & gotchas
- Do not make any changes until you have 95% confidence in what you need to build. Ask me follow-up questions until you reach that confidence.
- After all edits, always tell me what files have been changed.