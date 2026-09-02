"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ClassTextForm } from "@/components/class-text-form";
import { DatePicker } from "@/components/date-picker";
import { DraftProgress } from "@/components/draft-progress";
import { PhotoSlot } from "@/components/photo-slot";
import { SendResults, SendToPenyuluh } from "@/components/send-to-penyuluh";
import type { CompressResult } from "@/lib/compress";
import { formatLongDate, sundayOfWeek, toYmd } from "@/lib/dates";
import type {
  ClassText,
  DraftResult,
  KelompokName,
  SendResult,
  SidiaEntry,
  Teacher,
  TeacherAssignment,
} from "@/lib/types";
import { KELOMPOK_LIST } from "@/lib/types";
import {
  emptyClassTextSet,
  getLastClassText,
  saveLastClassText,
  getTeacherMapping,
  getCachedTeachers,
  saveCachedTeachers,
} from "@/lib/storage";

type PhotoState = Record<string, { foto1: CompressResult | null; foto2: CompressResult | null; foto3: CompressResult | null }>;

/**
 * Pause between two consecutive `/api/draft` submissions, in milliseconds.
 * SIDIA is a shared government Laravel app and drops drafts that arrive back
 * to back; spacing the writes out trades run time for a lower chance of a
 * silent loss. Change this one number to retune the pacing.
 */
const DELAY_PENGIRIMAN = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default function Home() {
  // Starts null on both server and first client render (even though
  // localStorage may already have data) so the two don't disagree and
  // trigger a hydration mismatch. The real cached value loads in the
  // effect below, same as the network fetch.
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Left undefined for the server render and filled in on mount, for the same
  // reason as the localStorage state above: "this week's Sunday" depends on the
  // viewer's timezone, and the server (UTC on Vercel) would compute a different
  // day from a WIB client late at night.
  const [date, setDate] = useState<Date | undefined>(undefined);
  const [classText, setClassText] = useState<Record<KelompokName, ClassText>>(
    emptyClassTextSet
  );
  const [photos, setPhotos] = useState<PhotoState>({});
  const [results, setResults] = useState<DraftResult[]>([]);
  const [running, setRunning] = useState(false);
  // Drafts SIDIA holds for a given date, tagged with the date they were read
  // for. The tag matters: switching dates mid-request would otherwise let a
  // slow response paint the old date's drafts under the new one.
  const [draftState, setDraftState] = useState<
    { tanggal: string; drafts: SidiaEntry[]; error?: string } | null
  >(null);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);
  // Purely cosmetic: which teacher the run is currently pacing towards, and
  // how many seconds are left. Kept out of DraftResult so the countdown can
  // never be mistaken for a real draft status.
  const [waiting, setWaiting] = useState<{ teacherId: string; secondsLeft: number } | null>(
    null
  );

  useEffect(() => {
    // One-time hydration from localStorage on mount (deliberately not a
    // lazy useState initializer — that would make the first client render
    // disagree with the server-rendered "null" state and trigger a
    // hydration mismatch, since SSR has no access to localStorage).
    const cached = getCachedTeachers();
    if (cached.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeachers(cached);
      setAssignments(getTeacherMapping());
    }
    setClassText(getLastClassText() ?? emptyClassTextSet());
    // Default to the Sunday whose class is being reported: the one that just
    // passed, or today when today is itself a Sunday.
    setDate(sundayOfWeek(new Date()));

    fetch("/api/teachers")
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data: { teachers: Teacher[] }) => {
        setTeachers(data.teachers);
        saveCachedTeachers(data.teachers);
        setAssignments(getTeacherMapping());
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError((prev) => prev ?? (err as Error).message);
      });
  }, []);

  const tanggal = date ? toYmd(date) : null;

  // What SIDIA still holds as a draft for this date is the only thing the send
  // button can trust: drafts may have been created in an earlier session, on
  // another device, or directly in SIDIA.
  const refreshDrafts = useCallback(async () => {
    if (!tanggal) return;
    try {
      const res = await fetch(`/api/drafts?tanggal=${tanggal}`);
      const data = (await res.json()) as { drafts?: SidiaEntry[]; error?: string };
      if (!res.ok || !data.drafts) throw new Error(data.error ?? `Server returned ${res.status}`);
      setDraftState({ tanggal, drafts: data.drafts });
    } catch (err) {
      setDraftState({ tanggal, drafts: [], error: (err as Error).message });
    }
  }, [tanggal]);

  useEffect(() => {
    // refreshDrafts only sets state after awaiting the fetch, never
    // synchronously — the rule just can't see past the await boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshDrafts();
  }, [refreshDrafts]);

  // null while the current date's drafts are unknown, so the send button says
  // "checking" and stays disabled instead of claiming there are none.
  const current = draftState?.tanggal === tanggal ? draftState : null;
  const drafts = current && !current.error ? current.drafts : null;
  const draftsError = current?.error ?? null;

  const mappingDone =
    teachers !== null &&
    teachers.length > 0 &&
    teachers.every((t) => assignments.some((a) => a.teacherId === t.id));

  const teacherCounts = useMemo(() => {
    const counts = {} as Record<KelompokName, number>;
    for (const k of KELOMPOK_LIST) counts[k] = 0;
    for (const a of assignments) counts[a.kelompok]++;
    return counts;
  }, [assignments]);

  function updateClassText(kelompok: KelompokName, patch: Partial<ClassText>) {
    const next = { ...classText, [kelompok]: { ...classText[kelompok], ...patch } };
    setClassText(next);
    // Persist on every keystroke rather than only after a successful run —
    // otherwise a refresh (or an accidental back) mid-typing loses the text.
    // Written here instead of in an effect on classText: the mount effect that
    // loads the saved text commits after the first render, so an effect would
    // race it and overwrite storage with the empty set.
    saveLastClassText(next);
  }

  function setPhoto(teacherId: string, slot: "foto1" | "foto2" | "foto3", result: CompressResult | null) {
    setPhotos((prev) => {
      const existing = prev[teacherId] ?? { foto1: null, foto2: null, foto3: null };
      return { ...prev, [teacherId]: { ...existing, [slot]: result } };
    });
  }

  const readyTeachers = useMemo(() => {
    if (!teachers) return [];
    return teachers.filter((t) => {
      const p = photos[t.id];
      return p && p.foto1 && p.foto2 && p.foto3;
    });
  }, [teachers, photos]);

  const canDraft =
    date !== undefined &&
    mappingDone &&
    readyTeachers.length > 0 &&
    KELOMPOK_LIST.every((k) => {
      const hasTeachers = teacherCounts[k] > 0;
      if (!hasTeachers) return true;
      const t = classText[k];
      return t.jenisPembelajaran && t.materi && t.catatan;
    });

  async function draftOne(
    teacher: Teacher,
    kelompok: KelompokName,
    forDate: string
  ): Promise<DraftResult> {
    const p = photos[teacher.id];
    const text = classText[kelompok];
    const form = new FormData();
    form.set("tanggal", forDate);
    form.set("pendidikId", teacher.id);
    form.set("kelompok", kelompok);
    form.set("jenisPembelajaran", text.jenisPembelajaran);
    form.set("materi", text.materi);
    form.set("catatan", text.catatan);
    form.set("foto1", p!.foto1!.blob, "foto1.jpg");
    form.set("foto2", p!.foto2!.blob, "foto2.jpg");
    form.set("foto3", p!.foto3!.blob, "foto3.jpg");

    const base = { teacherId: teacher.id, teacherName: teacher.name, kelompok };

    try {
      const res = await fetch("/api/draft", { method: "POST", body: form });
      const data = (await res.json()) as { status: DraftResult["status"]; message?: string };
      return { ...base, status: data.status, message: data.message };
    } catch (err) {
      // The request itself never completed, so SIDIA may or may not have
      // stored the record. Never call this "failed" — that reads as safe to
      // retry, and a retry here can duplicate the entry.
      return {
        ...base,
        status: "unconfirmed",
        message: `${(err as Error).message}. Check Riwayat for this date before retrying — this teacher may already have a draft.`,
      };
    }
  }

  /** Waits DELAY_PENGIRIMAN, ticking a visible countdown on the next teacher. */
  async function pauseBefore(nextTeacherId: string) {
    const endsAt = Date.now() + DELAY_PENGIRIMAN;
    let remaining = DELAY_PENGIRIMAN;
    while (remaining > 0) {
      setWaiting({ teacherId: nextTeacherId, secondsLeft: Math.ceil(remaining / 1000) });
      await sleep(Math.min(1000, remaining));
      remaining = endsAt - Date.now();
    }
    setWaiting(null);
  }

  async function handleDraftAll() {
    if (!teachers || !tanggal) return;
    // Snapshot the date once, so every teacher in the run is filed under the
    // same day even if the picker changes mid-run.
    const forDate = tanggal;
    setRunning(true);
    setSendResults(null);

    // "unconfirmed" counts as done for retry purposes: the record may well
    // exist in SIDIA, and a second attempt would duplicate it. Those get
    // resolved by looking at Riwayat, not by clicking again.
    const alreadyDone = new Set(
      results
        .filter((r) => r.status === "drafted" || r.status === "unconfirmed")
        .map((r) => r.teacherId)
    );

    const queue = readyTeachers
      .filter((t) => !alreadyDone.has(t.id))
      .map((t) => ({
        teacher: t,
        kelompok: assignments.find((a) => a.teacherId === t.id)!.kelompok,
      }));

    const initial: DraftResult[] = readyTeachers.map((t) => {
      const existing = results.find((r) => r.teacherId === t.id);
      // Preserve both terminal states so their result (and the "check Riwayat"
      // message) survives a retry run.
      if (existing?.status === "drafted" || existing?.status === "unconfirmed") {
        return existing;
      }
      return {
        teacherId: t.id,
        teacherName: t.name,
        kelompok: assignments.find((a) => a.teacherId === t.id)!.kelompok,
        status: "pending",
      };
    });
    setResults(initial);

    for (const [i, { teacher, kelompok }] of queue.entries()) {
      setResults((prev) =>
        prev.map((r) => (r.teacherId === teacher.id ? { ...r, status: "in_progress" } : r))
      );
      const result = await draftOne(teacher, kelompok, forDate);
      setResults((prev) => prev.map((r) => (r.teacherId === teacher.id ? result : r)));

      // Space the writes out — but only between teachers, never after the
      // last one, which would just stall the run at the finish line.
      const next = queue[i + 1];
      if (next) await pauseBefore(next.teacher.id);
    }

    setWaiting(null);
    setRunning(false);
    // Drafts just changed on SIDIA's side — re-read so the send button's count
    // reflects them rather than what this page assumed it created.
    await refreshDrafts();
  }

  function handleSent(sent: SendResult[]) {
    setSendResults(sent);
    void refreshDrafts();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">Weekly Upload</h1>
        <p className="text-sm text-muted-foreground">Kegiatan Belajar Mengajar (KBM)</p>
      </div>

      {teachers === null && loadError && (
        <Alert variant="destructive">
          <AlertTitle>Could not load teachers</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {teachers === null && !loadError && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {teachers && !mappingDone && (
        <Alert>
          <AlertTitle>Assign teachers to classes first</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>Before uploading, each teacher needs to be assigned to a class group.</p>
            <Button render={<Link href="/teachers" />} size="sm">
              Go to Teachers
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {teachers && mappingDone && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Date</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="tanggal">Tanggal (applies to all teachers)</Label>
                <DatePicker id="tanggal" value={date} onChange={setDate} />
              </div>
            </CardContent>
          </Card>

          <ClassTextForm value={classText} onChange={updateClassText} teacherCounts={teacherCounts} />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Photos per teacher</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {KELOMPOK_LIST.map((kelompok) => {
                const group = teachers.filter(
                  (t) => assignments.find((a) => a.teacherId === t.id)?.kelompok === kelompok
                );
                if (group.length === 0) return null;
                return (
                  <div key={kelompok} className="space-y-2">
                    <h3 className="text-sm font-semibold">{kelompok}</h3>
                    {group.map((t) => (
                      <div key={t.id} className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-4">
                        <div className="text-sm font-medium sm:col-span-1">{t.name}</div>
                        <div className="sm:col-span-1">
                          <PhotoSlot label="Foto 1" onCompressed={(r) => setPhoto(t.id, "foto1", r)} />
                        </div>
                        <div className="sm:col-span-1">
                          <PhotoSlot label="Foto 2" onCompressed={(r) => setPhoto(t.id, "foto2", r)} />
                        </div>
                        <div className="sm:col-span-1">
                          <PhotoSlot label="Foto 3" onCompressed={(r) => setPhoto(t.id, "foto3", r)} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Submit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Step 1 uploads the photos and text as drafts. Check them in SIDIA or Riwayat,
                then step 2 sends everything still in draft for this date to the penyuluh.
              </p>

              <Button
                disabled={!canDraft || running}
                onClick={handleDraftAll}
                className="w-full"
                size="lg"
              >
                {running
                  ? "Saving drafts…"
                  : `Save ${readyTeachers.length} draft${readyTeachers.length === 1 ? "" : "s"}`}
              </Button>

              <SendToPenyuluh
                tanggal={tanggal ?? ""}
                dateLabel={date ? formatLongDate(date) : ""}
                drafts={running ? null : drafts}
                onSent={handleSent}
                size="lg"
                className="w-full"
              />

              {draftsError && (
                <p className="text-sm text-destructive">
                  Could not check for drafts: {draftsError}
                </p>
              )}
            </CardContent>
          </Card>

          {results.length > 0 && <DraftProgress results={results} waiting={waiting} />}

          {sendResults && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Sent to penyuluh</CardTitle>
              </CardHeader>
              <CardContent>
                <SendResults results={sendResults} />
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
