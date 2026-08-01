"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import type { SubmitResult } from "@/lib/types";

const STATUS_LABEL: Record<SubmitResult["status"], string> = {
  pending: "Waiting",
  in_progress: "Sending…",
  submitted: "Submitted",
  draft_only: "Draft only — not sent",
  failed: "Failed",
};

const STATUS_VARIANT: Record<SubmitResult["status"], "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  in_progress: "secondary",
  submitted: "default",
  draft_only: "destructive",
  failed: "destructive",
};

interface SubmitProgressProps {
  results: SubmitResult[];
}

export function SubmitProgress({ results }: SubmitProgressProps) {
  const total = results.length;
  const done = results.filter((r) => r.status !== "pending" && r.status !== "in_progress").length;
  const submitted = results.filter((r) => r.status === "submitted").length;
  const problems = results.filter((r) => r.status === "draft_only" || r.status === "failed");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Submitting {done}/{total} — {submitted} confirmed sent
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
          {results.map((r) => (
            <div key={r.teacherId} className="flex items-center justify-between gap-3 p-2.5 text-sm">
              <div>
                <div className="font-medium">{r.teacherName}</div>
                <div className="text-xs text-muted-foreground">{r.kelompok}</div>
                {r.message && (
                  <div className="text-xs text-destructive">{r.message}</div>
                )}
              </div>
              <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABEL[r.status]}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
