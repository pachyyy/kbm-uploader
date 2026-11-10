"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { summarizeRun } from "@/lib/machines/draft-run";
import type { DraftResult } from "@/lib/types";

const STATUS_LABEL: Record<DraftResult["status"], string> = {
  pending: "Waiting",
  in_progress: "Saving…",
  drafted: "Draft saved",
  unconfirmed: "Unknown — check Riwayat",
  failed: "Failed",
  already_exists: "Already in SIDIA",
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
  already_exists: "outline",
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
  const { total, done, drafted, skipped, problems: problemCount } = summarizeRun(results);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Saving drafts {done}/{total} — {drafted} saved
          {skipped > 0 && `, ${skipped} already in SIDIA`}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Progress value={total === 0 ? 0 : (done / total) * 100} />

        {problemCount > 0 && (
          <p className="text-sm font-medium text-destructive">
            {problemCount} teacher{problemCount === 1 ? "" : "s"} need attention — see below.
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
                {r.message && (
                  <div
                    className={
                      r.status === "failed" || r.status === "unconfirmed"
                        ? "text-xs text-destructive"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {r.message}
                  </div>
                )}
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
