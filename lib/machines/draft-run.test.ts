import { describe, expect, it } from "vitest";
import type { DraftResult, SidiaEntry } from "../types";
import {
  draftRunReducer,
  findExisting,
  initialDraftRun,
  interpretDraftResponse,
  isRunLocked,
  normalizeName,
  planRun,
  resultsForDate,
  summarizeRun,
  type DraftRunEvent,
  type DraftRunState,
  type RosterItem,
} from "./draft-run";

const A: RosterItem = { teacherId: "1", teacherName: "Alice", kelompok: "Batita" };
const B: RosterItem = { teacherId: "2", teacherName: "Budi", kelompok: "Pre Teen" };

const result = (item: RosterItem, status: DraftResult["status"], message?: string): DraftResult => ({
  ...item,
  status,
  message,
});

const run = (state: DraftRunState, ...events: DraftRunEvent[]) =>
  events.reduce(draftRunReducer, state);

describe("run phases", () => {
  it("walks the happy path idle → checking → drafting → refreshing → idle", () => {
    let s = run(initialDraftRun, { type: "started", tanggal: "2026-08-02" });
    expect(s.phase).toBe("checking");

    s = run(s, { type: "planned", results: [result(A, "pending"), result(B, "pending")] });
    expect(s.phase).toBe("drafting");

    s = run(
      s,
      { type: "teacherStarted", teacherId: "1" },
      { type: "teacherFinished", teacherId: "1", status: "drafted" },
      { type: "waiting", waiting: { teacherId: "2", secondsLeft: 5 } },
      { type: "waitEnded" },
      { type: "teacherStarted", teacherId: "2" },
      { type: "teacherFinished", teacherId: "2", status: "drafted" },
      { type: "draftingDone" }
    );
    expect(s.phase).toBe("refreshing");

    s = run(s, { type: "refreshed" });
    expect(s).toMatchObject({ phase: "idle", error: null, tanggal: "2026-08-02" });
    expect(s.results.map((r) => r.status)).toEqual(["drafted", "drafted"]);
  });

  it("locks inputs in every phase except idle", () => {
    expect(isRunLocked(initialDraftRun)).toBe(false);
    const checking = run(initialDraftRun, { type: "started", tanggal: "d" });
    expect(isRunLocked(checking)).toBe(true);
    expect(isRunLocked(run(checking, { type: "planned", results: [] }))).toBe(true);
    expect(isRunLocked(run(checking, { type: "checkFailed", message: "x" }))).toBe(false);
  });

  it("ignores illegal events by returning the identical state object", () => {
    const idle = initialDraftRun;
    const events: DraftRunEvent[] = [
      { type: "checkFailed", message: "x" },
      { type: "planned", results: [] },
      { type: "teacherStarted", teacherId: "1" },
      { type: "waiting", waiting: { teacherId: "1", secondsLeft: 1 } },
      { type: "waitEnded" },
      { type: "teacherFinished", teacherId: "1", status: "drafted" },
      { type: "draftingDone" },
      { type: "refreshed" },
      { type: "aborted", message: "x" },
    ];
    for (const event of events) expect(draftRunReducer(idle, event)).toBe(idle);

    const checking = run(idle, { type: "started", tanggal: "d" });
    expect(draftRunReducer(checking, { type: "started", tanggal: "other" })).toBe(checking);
    expect(draftRunReducer(checking, { type: "draftingDone" })).toBe(checking);
  });

  it("only moves a teacher pending → in_progress → outcome, in that order", () => {
    const drafting = run(
      run(initialDraftRun, { type: "started", tanggal: "d" }),
      { type: "planned", results: [result(A, "pending"), result(B, "drafted")] }
    );
    // can't finish what never started
    expect(draftRunReducer(drafting, { type: "teacherFinished", teacherId: "1", status: "drafted" })).toBe(drafting);
    // can't restart a terminal teacher
    expect(draftRunReducer(drafting, { type: "teacherStarted", teacherId: "2" })).toBe(drafting);
    // unknown teacher
    expect(draftRunReducer(drafting, { type: "teacherStarted", teacherId: "nope" })).toBe(drafting);

    const started = run(drafting, { type: "teacherStarted", teacherId: "1" });
    expect(started.results[0].status).toBe("in_progress");
    // can't start twice
    expect(draftRunReducer(started, { type: "teacherStarted", teacherId: "1" })).toBe(started);
  });

  it("carries the SIDIA message onto the teacher and clears the countdown", () => {
    const s = run(
      initialDraftRun,
      { type: "started", tanggal: "d" },
      { type: "planned", results: [result(A, "pending")] },
      { type: "waiting", waiting: { teacherId: "1", secondsLeft: 3 } },
      { type: "teacherStarted", teacherId: "1" },
      { type: "teacherFinished", teacherId: "1", status: "failed", message: "Foto 1 too big" }
    );
    expect(s.results[0]).toMatchObject({ status: "failed", message: "Foto 1 too big" });
    expect(s.phase === "drafting" && s.waiting).toBeNull();
  });

  it("returns to idle with the error when the pre-run check fails, keeping earlier results", () => {
    const prior = [result(A, "drafted")];
    const idle: DraftRunState = { phase: "idle", tanggal: "d", results: prior, error: null };
    const s = run(idle, { type: "started", tanggal: "d" }, { type: "checkFailed", message: "boom" });
    expect(s).toMatchObject({ phase: "idle", error: "boom", results: prior });
  });

  it("clears a previous error when a new run starts", () => {
    const idle: DraftRunState = { phase: "idle", tanggal: "d", results: [], error: "old" };
    const s = run(idle, { type: "started", tanggal: "d" }, { type: "planned", results: [] }, { type: "draftingDone" }, { type: "refreshed" });
    expect(s).toMatchObject({ phase: "idle", error: null });
  });
});

describe("aborting", () => {
  it("turns the teacher caught mid-request into unconfirmed, never failed", () => {
    const s = run(
      initialDraftRun,
      { type: "started", tanggal: "d" },
      { type: "planned", results: [result(A, "pending"), result(B, "pending")] },
      { type: "teacherStarted", teacherId: "1" },
      { type: "aborted", message: "kaboom" }
    );
    expect(s.phase).toBe("idle");
    expect(s.results[0].status).toBe("unconfirmed");
    expect(s.results[0].message).toMatch(/Riwayat/);
    expect(s.results[1].status).toBe("pending"); // never reached SIDIA
    expect(s.phase === "idle" && s.error).toBe("kaboom");
  });

  it("unlocks the page from every non-idle phase", () => {
    const checking = run(initialDraftRun, { type: "started", tanggal: "d" });
    const drafting = run(checking, { type: "planned", results: [] });
    const refreshing = run(drafting, { type: "draftingDone" });
    for (const s of [checking, drafting, refreshing]) {
      expect(draftRunReducer(s, { type: "aborted", message: "x" }).phase).toBe("idle");
    }
  });
});

describe("results belong to one date", () => {
  const finished: DraftRunState = {
    phase: "idle",
    tanggal: "2026-08-02",
    results: [result(A, "drafted")],
    error: null,
  };

  it("hides results produced for another date", () => {
    expect(resultsForDate(finished, "2026-08-02")).toHaveLength(1);
    expect(resultsForDate(finished, "2026-08-09")).toEqual([]);
    expect(resultsForDate(finished, null)).toEqual([]);
  });

  it("starts a run on a new date with a clean slate, so last week's drafted teachers are not skipped", () => {
    const s = run(finished, { type: "started", tanggal: "2026-08-09" });
    expect(s).toMatchObject({ phase: "checking", tanggal: "2026-08-09", results: [] });
  });

  it("keeps the results when a run restarts on the same date", () => {
    const s = run(finished, { type: "started", tanggal: "2026-08-02" });
    expect(s.results).toEqual(finished.results);
  });

  it("brings the old date's results back if it is picked again before another run", () => {
    // Switching the picker never touches run state; only starting a run does.
    expect(resultsForDate(finished, "2026-08-02")).toEqual(finished.results);
  });
});

describe("planRun", () => {
  it("queues everyone when nothing has happened yet", () => {
    const plan = planRun({ previous: [], roster: [A, B], existing: {} });
    expect(plan.results.map((r) => r.status)).toEqual(["pending", "pending"]);
    expect(plan.queue).toEqual([A, B]);
  });

  it("never re-queues drafted or unconfirmed teachers, and keeps their messages", () => {
    const previous = [result(A, "drafted"), result(B, "unconfirmed", "check Riwayat")];
    const plan = planRun({ previous, roster: [A, B], existing: {} });
    expect(plan.queue).toEqual([]);
    expect(plan.results).toEqual(previous);
  });

  it("retries failed teachers, dropping the old failure message", () => {
    const plan = planRun({ previous: [result(A, "failed", "bad photo")], roster: [A], existing: {} });
    expect(plan.results[0]).toEqual({ ...A, status: "pending" });
    expect(plan.queue).toEqual([A]);
  });

  it("skips teachers SIDIA already holds an entry for", () => {
    const plan = planRun({ previous: [], roster: [A, B], existing: { "2": "Draft" } });
    expect(plan.queue).toEqual([A]);
    expect(plan.results[1]).toMatchObject({ status: "already_exists" });
    expect(plan.results[1].message).toMatch(/Already in SIDIA.*Draft/);
  });

  it("also skips a previously failed teacher that SIDIA turns out to have", () => {
    const plan = planRun({ previous: [result(A, "failed", "x")], roster: [A], existing: { "1": "Verifikasi Penyuluh" } });
    expect(plan.results[0].status).toBe("already_exists");
    expect(plan.queue).toEqual([]);
  });

  it("resolves an unconfirmed teacher to already_exists once SIDIA shows the entry", () => {
    const plan = planRun({ previous: [result(A, "unconfirmed", "?")], roster: [A], existing: { "1": "Draft" } });
    expect(plan.results[0]).toMatchObject({ status: "already_exists" });
    expect(plan.results[0].message).toMatch(/Confirmed/);
    expect(plan.queue).toEqual([]);
  });

  it("does not turn an unconfirmed teacher back into pending when SIDIA shows nothing (replica lag)", () => {
    const plan = planRun({ previous: [result(A, "unconfirmed", "?")], roster: [A], existing: {} });
    expect(plan.results[0].status).toBe("unconfirmed");
    expect(plan.queue).toEqual([]);
  });

  it("leaves a drafted teacher drafted even if SIDIA now lists them", () => {
    const plan = planRun({ previous: [result(A, "drafted")], roster: [A], existing: { "1": "Draft" } });
    expect(plan.results[0].status).toBe("drafted");
  });

  it("keeps already_exists terminal", () => {
    const prior = result(A, "already_exists", "skipped");
    const plan = planRun({ previous: [prior], roster: [A], existing: {} });
    expect(plan.results[0]).toEqual(prior);
    expect(plan.queue).toEqual([]);
  });

  it("only reports teachers on the roster", () => {
    const plan = planRun({ previous: [result(B, "drafted")], roster: [A], existing: {} });
    expect(plan.results.map((r) => r.teacherId)).toEqual(["1"]);
  });
});

describe("matching teachers to SIDIA entries", () => {
  const entry = (namaPendidik: string, status = "Draft"): SidiaEntry => ({
    uuid: namaPendidik,
    tanggal: "2026-08-02",
    tglLong: "Minggu, 02 Agustus 2026",
    namaPendidik,
    kelompok: "Batita",
    jenisPembelajaran: "Tilawati",
    status,
    isDraft: status === "Draft",
  });

  it("normalizes case, punctuation and spacing", () => {
    expect(normalizeName("ELISABET SUTANDIJO, SE.")).toBe("elisabet sutandijo se");
    expect(normalizeName("  Elisabet   Sutandijo SE ")).toBe("elisabet sutandijo se");
    expect(normalizeName("LAU,STEPHANIE LEO")).toBe("lau stephanie leo");
  });

  it("finds teachers by name regardless of formatting and reports the SIDIA status", () => {
    const found = findExisting(
      [
        { id: "10", name: "ELISABET SUTANDIJO, SE." },
        { id: "11", name: "FENNY OKTAVINA" },
      ],
      [entry("Elisabet Sutandijo SE", "Verifikasi Penyuluh")]
    );
    expect(found).toEqual({ "10": "Verifikasi Penyuluh" });
  });

  it("fails open: a name that matches nothing is simply not reported", () => {
    expect(findExisting([{ id: "1", name: "Alice" }], [entry("Someone Else")])).toEqual({});
  });

  it("does not match on a name fragment", () => {
    expect(findExisting([{ id: "1", name: "Ann" }], [entry("Anna Maria")])).toEqual({});
  });
});

describe("interpretDraftResponse", () => {
  it("passes through the statuses /api/draft is allowed to return", () => {
    expect(interpretDraftResponse(200, { status: "drafted" })).toEqual({ status: "drafted", message: undefined });
    expect(interpretDraftResponse(200, { status: "failed", message: "nope" })).toEqual({ status: "failed", message: "nope" });
    expect(interpretDraftResponse(502, { status: "unconfirmed", message: "?" })).toEqual({ status: "unconfirmed", message: "?" });
  });

  it("treats the login gate's 401 as failed — it never reached SIDIA", () => {
    const r = interpretDraftResponse(401, { error: "Authentication required." });
    expect(r.status).toBe("failed");
    expect(r.message).toMatch(/log in/i);
  });

  it("treats anything unrecognised as unconfirmed, never failed", () => {
    for (const [code, body] of [
      [500, null],
      [200, {}],
      [200, { status: "already_exists" }], // client-only status must not come from the server
      [200, { status: "banana" }],
      [504, "<html>gateway timeout</html>"],
    ] as const) {
      const r = interpretDraftResponse(code, body);
      expect(r.status).toBe("unconfirmed");
      expect(r.message).toMatch(/Riwayat/);
    }
  });
});

describe("summarizeRun", () => {
  it("counts each bucket", () => {
    const s = summarizeRun([
      result(A, "drafted"),
      result(B, "already_exists"),
      result({ ...A, teacherId: "3" }, "failed"),
      result({ ...A, teacherId: "4" }, "unconfirmed"),
      result({ ...A, teacherId: "5" }, "pending"),
      result({ ...A, teacherId: "6" }, "in_progress"),
    ]);
    expect(s).toEqual({ total: 6, done: 4, drafted: 1, skipped: 1, problems: 2 });
  });
});
