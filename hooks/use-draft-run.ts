"use client";

import { useCallback, useEffect, useReducer, useRef, type Dispatch } from "react";
import {
  draftRunReducer,
  initialDraftRun,
  isRunLocked,
  planRun,
  type DraftRunEvent,
  type RosterItem,
} from "@/lib/machines/draft-run";
import type { DraftResult, SubmitStatus } from "@/lib/types";

export interface StartRunArgs {
  /** The date every teacher in this run is filed under, snapshotted at click time. */
  tanggal: string;
  /** Teachers that have all three photos. */
  roster: RosterItem[];
  /** Results already on screen for `tanggal` (so terminal ones survive a retry). */
  previous: DraftResult[];
  /** teacherId → SIDIA status of an entry that already exists for `tanggal`. Throws if SIDIA can't be read. */
  checkExisting: () => Promise<Record<string, string>>;
  /** Stores one teacher. Must resolve (never throw) with the honest outcome. */
  submit: (item: RosterItem) => Promise<{ status: SubmitStatus; message?: string }>;
  /** Called once the writes are done — re-read what SIDIA now holds. */
  afterRun: () => Promise<void>;
  /** Pause between two consecutive submissions, in milliseconds. */
  pauseMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits `ms`, ticking a visible countdown on the teacher who is next. */
async function pauseBefore(ms: number, teacherId: string, dispatch: Dispatch<DraftRunEvent>) {
  const endsAt = Date.now() + ms;
  let remaining = ms;
  while (remaining > 0) {
    dispatch({ type: "waiting", waiting: { teacherId, secondsLeft: Math.ceil(remaining / 1000) } });
    await sleep(Math.min(1000, remaining));
    remaining = endsAt - Date.now();
  }
  dispatch({ type: "waitEnded" });
}

/**
 * The effect half of the draft-run machine: it does the I/O and pacing, and
 * every decision it makes is an event for `draftRunReducer`. Serial on
 * purpose — one teacher per request — see CLAUDE.md before changing that.
 */
async function drive(args: StartRunArgs, dispatch: Dispatch<DraftRunEvent>) {
  dispatch({ type: "started", tanggal: args.tanggal });

  try {
    // Fail closed: if SIDIA can't be read we can't promise not to duplicate,
    // so nothing is written. A visible failure beats a silent duplicate.
    let existing: Record<string, string>;
    try {
      existing = await args.checkExisting();
    } catch (err) {
      dispatch({
        type: "checkFailed",
        message: `Could not check SIDIA for existing entries: ${(err as Error).message}. Nothing was saved — try again.`,
      });
      return;
    }

    const plan = planRun({ previous: args.previous, roster: args.roster, existing });
    dispatch({ type: "planned", results: plan.results });

    for (const [i, item] of plan.queue.entries()) {
      dispatch({ type: "teacherStarted", teacherId: item.teacherId });
      const outcome = await args.submit(item);
      dispatch({
        type: "teacherFinished",
        teacherId: item.teacherId,
        status: outcome.status,
        message: outcome.message,
      });

      // Space the writes out — but only between teachers, never after the
      // last one, which would just stall the run at the finish line.
      const next = plan.queue[i + 1];
      if (next) await pauseBefore(args.pauseMs, next.teacherId, dispatch);
    }

    dispatch({ type: "draftingDone" });
    // Drafts just changed on SIDIA's side — the send button must reflect them
    // rather than what this page assumed it created.
    await args.afterRun();
    dispatch({ type: "refreshed" });
  } catch (err) {
    // Whatever escaped: never leave the page locked, and never call a teacher
    // caught mid-request anything but unconfirmed (the reducer handles that).
    dispatch({ type: "aborted", message: (err as Error).message });
  }
}

export function useDraftRun() {
  const [state, dispatch] = useReducer(draftRunReducer, initialDraftRun);
  const activeRef = useRef(false);
  const locked = isRunLocked(state);

  // Leaving mid-run strands teachers in an unknown state; make the browser ask.
  useEffect(() => {
    if (!locked) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [locked]);

  const start = useCallback(async (args: StartRunArgs) => {
    // Synchronous guard: a second call in the same tick must not start a
    // second concurrent loop.
    if (activeRef.current) return;
    activeRef.current = true;
    try {
      await drive(args, dispatch);
    } finally {
      activeRef.current = false;
    }
  }, []);

  return { state, start };
}
