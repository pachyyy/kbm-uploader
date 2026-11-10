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
import { useDraftRun } from "@/hooks/use-draft-run";
import type { CompressResult } from "@/lib/compress";
import { formatLongDate, sundayOfWeek, toYmd } from "@/lib/dates";
import {
  findExisting,
  interpretDraftResponse,
  isRunLocked,
  resultsForDate,
  type RosterItem,
} from "@/lib/machines/draft-run";
import { uploadPhase } from "@/lib/machines/upload-phase";
import type {
  ClassText,
  KelompokName,
  SendResult,
  SidiaEntry,
  SubmitStatus,
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
  // The draft run is a state machine (lib/machines/draft-run.ts) driven by
  // hooks/use-draft-run.ts. Its results are tagged with the date they belong to.
  const { state: run, start: startRun } = useDraftRun();
  const locked = isRunLocked(run);
  // Drafts SIDIA holds for a given date, tagged with the date they were read
  // for. The tag matters: switching dates mid-request would otherwise let a
  // slow response paint the old date's drafts under the new one.
  const [draftState, setDraftState] = useState<
    { tanggal: string; drafts: SidiaEntry[]; error?: string } | null
  >(null);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);

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

  // Results produced for another date say nothing about this one, so they are
  // hidden (and ignored by a new run) rather than shown under the wrong Sunday.
  const results = resultsForDate(run, tanggal);

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

  const phase = uploadPhase({ teachersLoaded: teachers !== null, loadError, mappingDone });

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
    item: RosterItem,
    forDate: string
  ): Promise<{ status: SubmitStatus; message?: string }> {
    const p = photos[item.teacherId];
    const text = classText[item.kelompok];
    const form = new FormData();
    form.set("tanggal", forDate);
    form.set("pendidikId", item.teacherId);
    form.set("kelompok", item.kelompok);
    form.set("jenisPembelajaran", text.jenisPembelajaran);
    form.set("materi", text.materi);
    form.set("catatan", text.catatan);
    form.set("foto1", p!.foto1!.blob, "foto1.jpg");
    form.set("foto2", p!.foto2!.blob, "foto2.jpg");
    form.set("foto3", p!.foto3!.blob, "foto3.jpg");

    try {
      const res = await fetch("/api/draft", { method: "POST", body: form });
      const body: unknown = await res.json().catch(() => null);
      return interpretDraftResponse(res.status, body);
    } catch (err) {
      // The request itself never completed, so SIDIA may or may not have
      // stored the record. Never call this "failed" — that reads as safe to
      // retry, and a retry here can duplicate the entry.
      return {
        status: "unconfirmed",
        message: `${(err as Error).message}. Check Riwayat for this date before retrying — this teacher may already have a draft.`,
      };
    }
  }

  /** Teachers that already have an entry in SIDIA for `forDate`, any status. Throws if SIDIA can't be read. */
  async function checkExisting(forDate: string) {
    const res = await fetch(`/api/entries?tanggal=${forDate}`);
    const data = (await res.json().catch(() => ({}))) as {
      entries?: SidiaEntry[];
      error?: string;
    };
    if (!res.ok || !data.entries) throw new Error(data.error ?? `Server returned ${res.status}`);
    return findExisting(teachers ?? [], data.entries);
  }

  async function handleDraftAll() {
    if (!teachers || !tanggal) return;
    // Snapshot the date once, so every teacher in the run is filed under the
    // same day. The picker is also locked for the duration of the run.
    const forDate = tanggal;
    setSendResults(null);

    const roster = readyTeachers.flatMap<RosterItem>((t) => {
      const kelompok = assignments.find((a) => a.teacherId === t.id)?.kelompok;
      return kelompok ? [{ teacherId: t.id, teacherName: t.name, kelompok }] : [];
    });

    await startRun({
      tanggal: forDate,
      roster,
      previous: results,
      checkExisting: () => checkExisting(forDate),
      submit: (item) => draftOne(item, forDate),
      afterRun: refreshDrafts,
      pauseMs: DELAY_PENGIRIMAN,
    });
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

      {phase === "load_error" && (
        <Alert variant="destructive">
          <AlertTitle>Could not load teachers</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {phase === "loading" && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}

      {phase === "needs_mapping" && (
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

      {phase === "ready" && teachers && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Date</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor="tanggal">Tanggal (applies to all teachers)</Label>
                <DatePicker id="tanggal" value={date} onChange={setDate} disabled={locked} />
              </div>
            </CardContent>
          </Card>

          <ClassTextForm
            value={classText}
            onChange={updateClassText}
            teacherCounts={teacherCounts}
            disabled={locked}
          />

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
                          <PhotoSlot
                            label="Foto 1"
                            disabled={locked}
                            onCompressed={(r) => setPhoto(t.id, "foto1", r)}
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <PhotoSlot
                            label="Foto 2"
                            disabled={locked}
                            onCompressed={(r) => setPhoto(t.id, "foto2", r)}
                          />
                        </div>
                        <div className="sm:col-span-1">
                          <PhotoSlot
                            label="Foto 3"
                            disabled={locked}
                            onCompressed={(r) => setPhoto(t.id, "foto3", r)}
                          />
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
                disabled={!canDraft || locked}
                onClick={handleDraftAll}
                className="w-full"
                size="lg"
              >
                {run.phase === "checking"
                  ? "Checking SIDIA for existing entries…"
                  : run.phase === "drafting"
                    ? "Saving drafts…"
                    : run.phase === "refreshing"
                      ? "Updating draft count…"
                      : `Save ${readyTeachers.length} draft${readyTeachers.length === 1 ? "" : "s"}`}
              </Button>

              <SendToPenyuluh
                tanggal={tanggal ?? ""}
                dateLabel={date ? formatLongDate(date) : ""}
                drafts={locked ? null : drafts}
                onSent={handleSent}
                size="lg"
                className="w-full"
              />

              {run.phase === "idle" && run.tanggal === tanggal && run.error && (
                <p className="text-sm text-destructive">{run.error}</p>
              )}

              {draftsError && (
                <p className="text-sm text-destructive">
                  Could not check for drafts: {draftsError}
                </p>
              )}
            </CardContent>
          </Card>

          {results.length > 0 && (
            <DraftProgress
              results={results}
              waiting={run.phase === "drafting" ? run.waiting : null}
            />
          )}

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
