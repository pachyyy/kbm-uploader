"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { KELOMPOK_LIST, type Teacher, type TeacherAssignment, type KelompokName } from "@/lib/types";
import {
  getTeacherMapping,
  saveTeacherMapping,
  getCachedTeachers,
  saveCachedTeachers,
} from "@/lib/storage";

interface TeacherMappingProps {
  /** Called every time the mapping changes and is fully assigned. */
  onComplete: (teachers: Teacher[], assignments: TeacherAssignment[]) => void;
}

function mergeAssignments(
  teachers: Teacher[],
  existing: Record<string, KelompokName | "">
): Record<string, KelompokName | ""> {
  const existingList = getTeacherMapping();
  const merged: Record<string, KelompokName | ""> = {};
  for (const t of teachers) {
    merged[t.id] =
      existing[t.id] ?? existingList.find((a) => a.teacherId === t.id)?.kelompok ?? "";
  }
  return merged;
}

export function TeacherMapping({ onComplete }: TeacherMappingProps) {
  // Starts null/empty on both server and first client render — reading
  // localStorage in a lazy useState initializer would make the client's
  // first render disagree with SSR (which has no localStorage) and trigger
  // a hydration mismatch, since this branches on `teachers` being non-null.
  const [teachers, setTeachers] = useState<Teacher[] | null>(null);
  const [assignments, setAssignments] = useState<Record<string, KelompokName | "">>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = getCachedTeachers();
    if (cached.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeachers(cached);
      setAssignments(mergeAssignments(cached, {}));
    }

    fetch("/api/teachers")
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data: { teachers: Teacher[] }) => {
        setTeachers(data.teachers);
        setAssignments((prev) => mergeAssignments(data.teachers, prev));
        saveCachedTeachers(data.teachers);
        setError(null);
      })
      .catch((err) => {
        setError((prevError) => {
          // Only surface a load error if we have no teachers to show at all
          // (from cache or a prior successful fetch) — a transient network
          // blip shouldn't blank out an already-working screen.
          return prevError ?? `${err.message}`;
        });
      })
      .finally(() => setLoading(false));
  }, []);

  function setKelompok(teacherId: string, kelompok: KelompokName) {
    setAssignments((prev) => {
      const next = { ...prev, [teacherId]: kelompok };

      if (teachers && teachers.every((t) => next[t.id])) {
        const result: TeacherAssignment[] = teachers.map((t) => ({
          teacherId: t.id,
          kelompok: next[t.id] as KelompokName,
        }));
        saveTeacherMapping(result);
        onComplete(teachers, result);
        toast.success(`${teachers.find((t) => t.id === teacherId)?.name} set to ${kelompok}`);
      }

      return next;
    });
  }

  const allAssigned =
    teachers !== null &&
    teachers.length > 0 &&
    teachers.every((t) => assignments[t.id]);

  const counts = KELOMPOK_LIST.reduce<Record<KelompokName, number>>((acc, k) => {
    acc[k] = Object.values(assignments).filter((v) => v === k).length;
    return acc;
  }, {} as Record<KelompokName, number>);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assign teachers to class groups</CardTitle>
        <CardDescription>
          Saved on this device automatically as you assign each teacher. Revisit anytime to change one.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && teachers === null && (
          <p className="text-sm text-muted-foreground">Loading teacher list from SIDIA…</p>
        )}
        {error && teachers === null && <p className="text-sm text-destructive">{error}</p>}

        {teachers && teachers.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {KELOMPOK_LIST.map((k) => (
                <Badge key={k} variant={counts[k] > 0 ? "default" : "outline"}>
                  {k}: {counts[k]}
                </Badge>
              ))}
              {!allAssigned && (
                <span className="text-xs text-muted-foreground">
                  {teachers.length - Object.values(assignments).filter(Boolean).length} unassigned
                </span>
              )}
            </div>

            <div className="divide-y rounded-md border">
              {teachers.map((t) => (
                <div key={t.id} className="flex items-center justify-between gap-4 p-3">
                  <span className="text-sm font-medium">{t.name}</span>
                  <Select
                    value={assignments[t.id] || undefined}
                    onValueChange={(v) => setKelompok(t.id, v as KelompokName)}
                  >
                    <SelectTrigger className="w-45">
                      <SelectValue placeholder="Choose class…" />
                    </SelectTrigger>
                    <SelectContent>
                      {KELOMPOK_LIST.map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
