"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ClassTextForm } from "@/components/class-text-form";
import { PhotoSlot } from "@/components/photo-slot";
import { SubmitProgress } from "@/components/submit-progress";
import type { CompressResult } from "@/lib/compress";
import type { ClassText, KelompokName, SubmitResult, Teacher, TeacherAssignment } from "@/lib/types";
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

export default function Home() {
  // Starts null on both server and first client render (even though
  // localStorage may already have data) so the two don't disagree and
  // trigger a hydration mismatch. The real cached value loads in the
  // effect below, same as the network fetch.
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [date, setDate] = useState("");
  const [classText, setClassText] = useState<Record<KelompokName, ClassText>>(
    emptyClassTextSet
  );
  const [photos, setPhotos] = useState<PhotoState>({});
  const [results, setResults] = useState<SubmitResult[]>([]);
  const [running, setRunning] = useState(false);

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
    setClassText((prev) => ({ ...prev, [kelompok]: { ...prev[kelompok], ...patch } }));
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

  const canSubmit =
    date.length > 0 &&
    mappingDone &&
    readyTeachers.length > 0 &&
    KELOMPOK_LIST.every((k) => {
      const hasTeachers = teacherCounts[k] > 0;
      if (!hasTeachers) return true;
      const t = classText[k];
      return t.jenisPembelajaran && t.materi && t.catatan;
    });

  async function submitOne(teacher: Teacher, kelompok: KelompokName): Promise<SubmitResult> {
    const p = photos[teacher.id];
    const text = classText[kelompok];
    const form = new FormData();
    form.set("tanggal", date);
    form.set("pendidikId", teacher.id);
    form.set("kelompok", kelompok);
    form.set("jenisPembelajaran", text.jenisPembelajaran);
    form.set("materi", text.materi);
    form.set("catatan", text.catatan);
    form.set("foto1", p!.foto1!.blob, "foto1.jpg");
    form.set("foto2", p!.foto2!.blob, "foto2.jpg");
    form.set("foto3", p!.foto3!.blob, "foto3.jpg");

    try {
      const res = await fetch("/api/submit", { method: "POST", body: form });
      const data = (await res.json()) as { status: SubmitResult["status"]; message?: string; uuid?: string };
      return {
        teacherId: teacher.id,
        teacherName: teacher.name,
        kelompok,
        status: data.status,
        message: data.message,
        uuid: data.uuid,
      };
    } catch (err) {
      return {
        teacherId: teacher.id,
        teacherName: teacher.name,
        kelompok,
        status: "failed",
        message: (err as Error).message,
      };
    }
  }

  async function handleSubmitAll() {
    if (!teachers) return;
    setRunning(true);

    const alreadyDone = new Set(
      results.filter((r) => r.status === "submitted").map((r) => r.teacherId)
    );

    const queue = readyTeachers
      .filter((t) => !alreadyDone.has(t.id))
      .map((t) => ({
        teacher: t,
        kelompok: assignments.find((a) => a.teacherId === t.id)!.kelompok,
      }));

    const initial: SubmitResult[] = readyTeachers.map((t) => {
      const existing = results.find((r) => r.teacherId === t.id);
      if (existing?.status === "submitted") return existing;
      return {
        teacherId: t.id,
        teacherName: t.name,
        kelompok: assignments.find((a) => a.teacherId === t.id)!.kelompok,
        status: "pending",
      };
    });
    setResults(initial);

    for (const { teacher, kelompok } of queue) {
      setResults((prev) =>
        prev.map((r) => (r.teacherId === teacher.id ? { ...r, status: "in_progress" } : r))
      );
      const result = await submitOne(teacher, kelompok);
      setResults((prev) => prev.map((r) => (r.teacherId === teacher.id ? result : r)));
    }

    saveLastClassText(classText);
    setRunning(false);
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
                <Input id="tanggal" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
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

          <Button disabled={!canSubmit || running} onClick={handleSubmitAll} className="w-full" size="lg">
            {running
              ? "Submitting…"
              : `Submit ${readyTeachers.length} teacher${readyTeachers.length === 1 ? "" : "s"}`}
          </Button>

          {results.length > 0 && <SubmitProgress results={results} />}
        </>
      )}
    </div>
  );
}
