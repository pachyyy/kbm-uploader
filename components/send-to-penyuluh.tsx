"use client";

import { useReducer } from "react";
import { SendIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  initialSendFlow,
  isSendDialogOpen,
  sendFlowReducer,
} from "@/lib/machines/send-flow";
import type { SendResult, SidiaEntry } from "@/lib/types";

interface SendToPenyuluhProps {
  tanggal: string;
  /** Human-readable date for the confirmation copy. */
  dateLabel: string;
  /** Drafts for this date, or null while they are still being read from SIDIA. */
  drafts: SidiaEntry[] | null;
  onSent: (results: SendResult[]) => void;
  size?: "default" | "lg";
  className?: string;
}

export function SendToPenyuluh({
  tanggal,
  dateLabel,
  drafts,
  onSent,
  size = "default",
  className,
}: SendToPenyuluhProps) {
  // idle → confirming → sending → idle, with failures returning to confirming.
  // The rules live in lib/machines/send-flow.ts.
  const [flow, dispatch] = useReducer(sendFlowReducer, initialSendFlow);
  const sending = flow.kind === "sending";
  const error = flow.kind === "confirming" ? flow.error : null;

  const count = drafts?.length ?? 0;

  async function handleSend() {
    dispatch({ type: "confirm" });
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tanggal }),
      });
      const data = (await res.json()) as { results?: SendResult[]; error?: string };
      if (!res.ok || !data.results) {
        throw new Error(data.error ?? `Server returned ${res.status}`);
      }
      dispatch({ type: "succeeded" });
      onSent(data.results);
    } catch (err) {
      dispatch({ type: "failed", message: (err as Error).message });
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size={size}
        className={className}
        disabled={drafts === null || count === 0 || sending}
        onClick={() => dispatch({ type: "open" })}
      >
        <SendIcon data-icon="inline-start" />
        {drafts === null
          ? "Checking drafts…"
          : count === 0
            ? "No drafts to send"
            : `Send ${count} draft${count === 1 ? "" : "s"} to penyuluh`}
      </Button>

      {/* While sending, "cancel" is an illegal event and the reducer ignores it,
          so Escape / outside-click cannot dismiss a request that is in flight. */}
      <Dialog
        open={isSendDialogOpen(flow)}
        onOpenChange={(next) => !next && dispatch({ type: "cancel" })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send to penyuluh?</DialogTitle>
            <DialogDescription>
              {count} draft{count === 1 ? "" : "s"} for {dateLabel} will be submitted for
              verification. This app cannot undo it — a mistake has to be fixed in SIDIA.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-56 divide-y overflow-y-auto rounded-md border text-sm">
            {drafts?.map((d) => (
              <div key={d.uuid} className="flex items-center justify-between gap-3 p-2">
                <span className="font-medium">{d.namaPendidik}</span>
                <Badge variant="outline">{d.kelompok}</Badge>
              </div>
            ))}
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <DialogClose render={<Button variant="ghost" disabled={sending} />}>
              Cancel
            </DialogClose>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? "Sending…" : `Send ${count}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function SendResults({ results }: { results: SendResult[] }) {
  const failed = results.filter((r) => !r.ok);

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">
        {results.length - failed.length} of {results.length} sent to penyuluh
        {failed.length > 0 && ` — ${failed.length} failed`}
      </p>
      <div className="divide-y rounded-md border">
        {results.map((r) => (
          <div key={r.uuid} className="flex items-center justify-between gap-3 p-2.5 text-sm">
            <div>
              <div className="font-medium">{r.namaPendidik}</div>
              <div className="text-xs text-muted-foreground">{r.kelompok}</div>
              {r.message && <div className="text-xs text-destructive">{r.message}</div>}
            </div>
            <Badge variant={r.ok ? "default" : "destructive"}>
              {r.ok ? "Sent" : "Failed"}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
