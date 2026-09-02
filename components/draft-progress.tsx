"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { DraftResult } from "@/lib/types";

const STATUS_LABEL: Record<DraftResult["status"], string> = {
  pending: "Waiting",
  in_progress: "Saving…",
  drafted: "Draft saved",
  unconfirmed: "Unknown — check Riwayat",
  failed: "Failed",
};

const STATUS_VARIANT: Record<
  DraftResult["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "outline",
  in_progress: "secondary",
  drafted: "default",
  unconfirmed: "secondary",
  failed: "destructive",
};

interface DraftProgressProps {
  results: DraftResult[];
  /**
   * The teacher the run is currently pacing towards, and the seconds left
   * before their submission starts. Display only — a paced teacher is still
   * "pending", so nothing here changes what a retry considers done.
   */
  waiting?: { teacherId: string; secondsLeft: number } | null;
}

export function DraftProgress({ results, waiting }: DraftProgressProps) {
  const total = results.length;
  const done = results.filter(
    (r) => r.status !== "pending" && r.status !== "in_progress"
  ).length;
  const drafted = results.filter((r) => r.status === "drafted").length;
  const problems = results.filter(
    (r) => r.status === "failed" || r.status === "unconfirmed"
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Saving drafts {done}/{total} — {drafted} saved
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={total === 0 ? 0 : (done / total) * 100} />

        {problems.length > 0 && (
          <p className="text-sm font-medium text-destructive">
            {problems.length} teacher{problems.length === 1 ? "" : "s"} need attention — see below.
          </p>
        )}

        <div className="divide-y rounded-md border">
          {results.map((r) => {
            const counting =
              r.status === "pending" && waiting?.teacherId === r.teacherId ? waiting : null;
            return (
            <div key={r.teacherId} className="flex items-center justify-between gap-3 p-2.5 text-sm">
              <div>
                <div className="font-medium">{r.teacherName}</div>
                <div className="text-xs text-muted-foreground">{r.kelompok}</div>
                {r.message && <div className="text-xs text-destructive">{r.message}</div>}
              </div>
              <Badge variant={counting ? "secondary" : STATUS_VARIANT[r.status]}>
                {counting ? `Next in ${counting.secondsLeft}s…` : STATUS_LABEL[r.status]}
              </Badge>
            </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
