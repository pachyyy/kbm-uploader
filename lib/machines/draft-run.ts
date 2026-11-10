/**
 * The draft run: saving every ready teacher's report to SIDIA as a draft, one
 * request at a time. Pure — no fetch, no timers, no React. `hooks/use-draft-run.ts`
 * is the thin driver that performs the effects and feeds events in.
 *
 * Why this is a machine and not a pile of flags: the run is where a mistake
 * costs a duplicate government record. Every rule that protects against that
 * (what is terminal, what a retry may touch, which date results belong to) is
 * written down here once, and illegal moves are ignored rather than trusted.
 * The full transition tables live in docs/state-machines.md.
 *
 * Run phases
 *   idle ──started──▶ checking ──planned──▶ drafting ──draftingDone──▶ refreshing ──refreshed──▶ idle
 *                        │                      │                          │
 *                        └─checkFailed─▶ idle   └──────── aborted ─────────┴──────▶ idle
 *
 * Per-teacher status (DraftStatus), within `drafting`
 *   pending ──teacherStarted──▶ in_progress ──teacherFinished──▶ drafted | unconfirmed | failed
 *   `already_exists` is assigned at planning time and never entered mid-run.
 *   drafted / unconfirmed / already_exists are terminal for retry purposes;
 *   failed goes back to pending on the next run.
 */
import type {
  DraftResult,
  DraftStatus,
  KelompokName,
  SidiaEntry,
  SubmitStatus,
  Teacher,
} from "../types";

export interface RosterItem {
  teacherId: string;
  teacherName: string;
  kelompok: KelompokName;
}

export interface Waiting {
  teacherId: string;
  secondsLeft: number;
}

/**
 * `tanggal` tags the date the results were produced for. Consumers must treat
 * results as unknown when it differs from the date on screen — see
 * `resultsForDate`. (Without the tag, results from one Sunday made the next
 * Sunday's run skip those teachers.)
 */
export type DraftRunState =
  | { phase: "idle"; tanggal: string | null; results: DraftResult[]; error: string | null }
  | { phase: "checking"; tanggal: string; results: DraftResult[] }
  | { phase: "drafting"; tanggal: string; results: DraftResult[]; waiting: Waiting | null }
  | { phase: "refreshing"; tanggal: string; results: DraftResult[] };

export type DraftRunEvent =
  | { type: "started"; tanggal: string }
  | { type: "checkFailed"; message: string }
  | { type: "planned"; results: DraftResult[] }
  | { type: "teacherStarted"; teacherId: string }
  | { type: "waiting"; waiting: Waiting }
  | { type: "waitEnded" }
  | { type: "teacherFinished"; teacherId: string; status: SubmitStatus; message?: string }
  | { type: "draftingDone" }
  | { type: "refreshed" }
  | { type: "aborted"; message: string };

export const initialDraftRun: DraftRunState = {
  phase: "idle",
  tanggal: null,
  results: [],
  error: null,
};

/** Statuses a later run must never touch: the record exists or may exist. */
const TERMINAL: ReadonlySet<DraftStatus> = new Set<DraftStatus>([
  "drafted",
  "unconfirmed",
  "already_exists",
]);

export function isTerminal(status: DraftStatus): boolean {
  return TERMINAL.has(status);
}

const INTERRUPTED_MESSAGE =
  "The run was interrupted while this teacher was being saved, so SIDIA may or may not have stored it. Check Riwayat for this date before retrying.";

function mapResult(
  results: DraftResult[],
  teacherId: string,
  from: DraftStatus,
  update: (r: DraftResult) => DraftResult
): DraftResult[] | null {
  const index = results.findIndex((r) => r.teacherId === teacherId);
  if (index === -1 || results[index].status !== from) return null; // illegal move
  const next = results.slice();
  next[index] = update(results[index]);
  return next;
}

/** Illegal events return the same state object, so they are cheap to detect and cannot corrupt anything. */
export function draftRunReducer(state: DraftRunState, event: DraftRunEvent): DraftRunState {
  switch (event.type) {
    case "started": {
      if (state.phase !== "idle") return state;
      return {
        phase: "checking",
        tanggal: event.tanggal,
        // Results belong to one date. Starting on another date begins afresh.
        results: state.tanggal === event.tanggal ? state.results : [],
      };
    }

    case "checkFailed": {
      if (state.phase !== "checking") return state;
      return { phase: "idle", tanggal: state.tanggal, results: state.results, error: event.message };
    }

    case "planned": {
      if (state.phase !== "checking") return state;
      return { phase: "drafting", tanggal: state.tanggal, results: event.results, waiting: null };
    }

    case "teacherStarted": {
      if (state.phase !== "drafting") return state;
      const results = mapResult(state.results, event.teacherId, "pending", (r) => ({
        ...r,
        status: "in_progress",
      }));
      return results ? { ...state, results } : state;
    }

    case "waiting": {
      if (state.phase !== "drafting") return state;
      return { ...state, waiting: event.waiting };
    }

    case "waitEnded": {
      if (state.phase !== "drafting") return state;
      return state.waiting === null ? state : { ...state, waiting: null };
    }

    case "teacherFinished": {
      if (state.phase !== "drafting") return state;
      const results = mapResult(state.results, event.teacherId, "in_progress", (r) => ({
        ...r,
        status: event.status,
        message: event.message,
      }));
      return results ? { ...state, results, waiting: null } : state;
    }

    case "draftingDone": {
      if (state.phase !== "drafting") return state;
      return { phase: "refreshing", tanggal: state.tanggal, results: state.results };
    }

    case "refreshed": {
      if (state.phase !== "refreshing") return state;
      return { phase: "idle", tanggal: state.tanggal, results: state.results, error: null };
    }

    case "aborted": {
      if (state.phase === "idle") return state;
      return {
        phase: "idle",
        tanggal: state.tanggal,
        // A teacher caught mid-request is genuinely unknown — never "failed".
        results: state.results.map((r) =>
          r.status === "in_progress"
            ? { ...r, status: "unconfirmed", message: INTERRUPTED_MESSAGE }
            : r
        ),
        error: event.message,
      };
    }
  }
}

/** Inputs (date, photos, text) are frozen for the whole run, including the checks around it. */
export function isRunLocked(state: DraftRunState): boolean {
  return state.phase !== "idle";
}

/** The results that are true for the date on screen — empty if they were produced for another date. */
export function resultsForDate(state: DraftRunState, tanggal: string | null): DraftResult[] {
  return tanggal !== null && state.tanggal === tanggal ? state.results : [];
}

/**
 * Decides, from the previous results and what SIDIA already holds for the
 * date, which teachers a run will submit.
 *
 * `existing` maps teacherId → the SIDIA status text of an entry already filed
 * for them on this date.
 *
 *  - drafted               stays drafted
 *  - unconfirmed           stays terminal, but becomes already_exists if SIDIA
 *                          now shows the entry (the uncertainty is resolved)
 *  - already_exists        stays
 *  - failed / new          already in SIDIA → already_exists, otherwise pending
 */
export function planRun(input: {
  previous: DraftResult[];
  roster: RosterItem[];
  existing: Record<string, string>;
}): { results: DraftResult[]; queue: RosterItem[] } {
  const { previous, roster, existing } = input;

  const results = roster.map<DraftResult>((item) => {
    const prior = previous.find((r) => r.teacherId === item.teacherId);
    const sidiaStatus = existing[item.teacherId];
    const base = {
      teacherId: item.teacherId,
      teacherName: item.teacherName,
      kelompok: item.kelompok,
    };

    if (prior?.status === "drafted") return prior;
    if (prior?.status === "unconfirmed") {
      return sidiaStatus === undefined
        ? prior
        : {
            ...base,
            status: "already_exists",
            message: `Confirmed: SIDIA has this entry (${sidiaStatus}).`,
          };
    }
    if (prior?.status === "already_exists") return prior;

    if (sidiaStatus !== undefined) {
      return {
        ...base,
        status: "already_exists",
        message: `Already in SIDIA for this date (${sidiaStatus}) — skipped to avoid a duplicate.`,
      };
    }
    return { ...base, status: "pending" };
  });

  const pending = new Set(results.filter((r) => r.status === "pending").map((r) => r.teacherId));
  return { results, queue: roster.filter((item) => pending.has(item.teacherId)) };
}

/** Lower-cased, punctuation-free, single-spaced — so "ELISABET SUTANDIJO, SE." equals "Elisabet Sutandijo SE". */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Which teachers already have an entry in `entries` (all of one date's SIDIA
 * rows, any status). Matched by name because ajax_index exposes no pendidik_id.
 * A name that matches nothing simply isn't reported, which is the old
 * behaviour (draft as usual) — the guard can fail to help but not block.
 */
export function findExisting(teachers: Teacher[], entries: SidiaEntry[]): Record<string, string> {
  const byName = new Map<string, SidiaEntry>();
  for (const entry of entries) byName.set(normalizeName(entry.namaPendidik), entry);

  const found: Record<string, string> = {};
  for (const teacher of teachers) {
    const entry = byName.get(normalizeName(teacher.name));
    if (entry) found[teacher.id] = entry.status || "status unknown";
  }
  return found;
}

const SUBMIT_STATUSES: ReadonlySet<string> = new Set(["drafted", "unconfirmed", "failed"]);

/**
 * Turns whatever came back from POST /api/draft into a SubmitStatus. The rule
 * for anything unexpected is `unconfirmed`: when we cannot tell whether SIDIA
 * stored the record, claiming "failed" would invite a duplicating retry.
 * The one exception is a 401 — the login gate answered, so the request never
 * reached SIDIA.
 */
export function interpretDraftResponse(
  httpStatus: number,
  body: unknown
): { status: SubmitStatus; message?: string } {
  if (typeof body === "object" && body !== null) {
    const { status, message } = body as { status?: unknown; message?: unknown };
    if (typeof status === "string" && SUBMIT_STATUSES.has(status)) {
      return {
        status: status as SubmitStatus,
        message: typeof message === "string" ? message : undefined,
      };
    }
  }

  if (httpStatus === 401) {
    return { status: "failed", message: "Your login expired. Log in again, then retry." };
  }
  return {
    status: "unconfirmed",
    message: `Unexpected response from the server (HTTP ${httpStatus}). Check Riwayat for this date before retrying — this teacher may already have a draft.`,
  };
}

/** Counts shown in the progress header. */
export function summarizeRun(results: DraftResult[]) {
  const count = (...s: DraftStatus[]) => results.filter((r) => s.includes(r.status)).length;
  return {
    total: results.length,
    done: results.length - count("pending", "in_progress"),
    drafted: count("drafted"),
    skipped: count("already_exists"),
    problems: count("failed", "unconfirmed"),
  };
}
