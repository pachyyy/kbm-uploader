"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface HistoryRow {
  uuid: string;
  tanggal: string;
  tgl_long: string;
  nama_pendidik: string;
  kelompok: string;
  jenis_pembelajaran: string;
  status: string;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s.includes("draft")) return "destructive";
  if (s.includes("disetujui")) return "default";
  return "secondary";
}

export default function Riwayat() {
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/history")
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json();
      })
      .then((data: { rows: HistoryRow[] }) => setRows(data.rows))
      .catch((err) => setError((err as Error).message));
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">Riwayat</h1>
        <p className="text-sm text-muted-foreground">Recent SIDIA submissions</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent SIDIA submissions</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">Could not load history: {error}</p>}
          {!rows && !error && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}
          {rows && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">No entries found.</p>
          )}
          {rows && rows.length > 0 && (
            <div className="divide-y rounded-md border">
              {rows.map((r) => (
                <div key={r.uuid} className="flex items-center justify-between gap-3 p-2.5 text-sm">
                  <div>
                    <div className="font-medium">{r.nama_pendidik}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.tgl_long} · {r.kelompok} · {r.jenis_pembelajaran}
                    </div>
                  </div>
                  <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
