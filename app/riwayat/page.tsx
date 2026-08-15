"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronRightIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { SendResults, SendToPenyuluh } from "@/components/send-to-penyuluh";
import type { EntryGroup, SendResult } from "@/lib/types";

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s.includes("draft")) return "destructive";
  if (s.includes("disetujui")) return "default";
  return "secondary";
}

export default function Riwayat() {
  const [groups, setGroups] = useState<EntryGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The date whose modal is open, kept as a key rather than the group object
  // so the modal follows the refreshed data after a send.
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [sendResults, setSendResults] = useState<SendResult[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/history");
      const data = (await res.json()) as { groups?: EntryGroup[]; error?: string };
      if (!res.ok || !data.groups) throw new Error(data.error ?? `Server returned ${res.status}`);
      setGroups(data.groups);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    // load only sets state after awaiting the fetch, never synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const openGroup = groups?.find((g) => g.tanggal === openDate) ?? null;

  function handleSent(results: SendResult[]) {
    setSendResults(results);
    void load();
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <div>
        <h1 className="text-2xl font-bold">Riwayat</h1>
        <p className="text-sm text-muted-foreground">Recent SIDIA submissions by date</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submission dates</CardTitle>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">Could not load history: {error}</p>}

          {!groups && !error && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          )}

          {groups && groups.length === 0 && (
            <p className="text-sm text-muted-foreground">No entries found.</p>
          )}

          {groups && groups.length > 0 && (
            <div className="divide-y rounded-md border">
              {groups.map((g) => (
                <button
                  key={g.tanggal}
                  type="button"
                  onClick={() => {
                    setSendResults(null);
                    setOpenDate(g.tanggal);
                  }}
                  className="flex w-full items-center justify-between gap-3 p-2.5 text-left text-sm hover:bg-muted"
                >
                  <div>
                    <div className="font-medium">{g.tglLong}</div>
                    <div className="text-xs text-muted-foreground">
                      {g.total} {g.total === 1 ? "entry" : "entries"}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {g.draftCount > 0 && (
                      <Badge variant="destructive">{g.draftCount} draft</Badge>
                    )}
                    <ChevronRightIcon className="size-4 text-muted-foreground" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={openGroup !== null} onOpenChange={(next) => !next && setOpenDate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{openGroup?.tglLong}</DialogTitle>
            <DialogDescription>
              {openGroup?.total} {openGroup?.total === 1 ? "entry" : "entries"}
              {openGroup && openGroup.draftCount > 0 && ` · ${openGroup.draftCount} still draft`}
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-80 divide-y overflow-y-auto rounded-md border text-sm">
            {openGroup?.entries.map((e) => (
              <div key={e.uuid} className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <div className="font-medium">{e.namaPendidik}</div>
                  <div className="text-xs text-muted-foreground">
                    {e.kelompok} · {e.jenisPembelajaran}
                  </div>
                </div>
                <Badge variant={statusVariant(e.status)}>{e.status}</Badge>
              </div>
            ))}
          </div>

          {sendResults && <SendResults results={sendResults} />}

          {openGroup && openGroup.draftCount > 0 && (
            <SendToPenyuluh
              tanggal={openGroup.tanggal}
              dateLabel={openGroup.tglLong}
              drafts={openGroup.entries.filter((e) => e.isDraft)}
              onSent={handleSent}
              className="w-full"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
