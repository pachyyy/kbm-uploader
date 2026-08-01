"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { KELOMPOK_LIST, type ClassText, type KelompokName } from "@/lib/types";

interface ClassTextFormProps {
  value: Record<KelompokName, ClassText>;
  onChange: (kelompok: KelompokName, patch: Partial<ClassText>) => void;
  teacherCounts: Record<KelompokName, number>;
}

export function ClassTextForm({ value, onChange, teacherCounts }: ClassTextFormProps) {
  return (
    <div className="space-y-4">
      {KELOMPOK_LIST.map((kelompok) => (
        <Card key={kelompok}>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>{kelompok}</span>
              <span className="text-xs font-normal text-muted-foreground">
                {teacherCounts[kelompok] ?? 0} teacher{teacherCounts[kelompok] === 1 ? "" : "s"}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`${kelompok}-metode`}>Metode Pembelajaran</Label>
              <Input
                id={`${kelompok}-metode`}
                placeholder="Ex: Tilawati/Iqra'/Tahfidz/Dll"
                value={value[kelompok]?.jenisPembelajaran ?? ""}
                onChange={(e) => onChange(kelompok, { jenisPembelajaran: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${kelompok}-materi`}>Aktivitas/Materi</Label>
              <Textarea
                id={`${kelompok}-materi`}
                rows={3}
                value={value[kelompok]?.materi ?? ""}
                onChange={(e) => onChange(kelompok, { materi: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${kelompok}-catatan`}>Catatan Perkembangan</Label>
              <Textarea
                id={`${kelompok}-catatan`}
                rows={3}
                value={value[kelompok]?.catatan ?? ""}
                onChange={(e) => onChange(kelompok, { catatan: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
