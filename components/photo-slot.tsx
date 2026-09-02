"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ImageUpIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { compressPhoto, HeicUnsupportedError, type CompressResult } from "@/lib/compress";

interface PhotoSlotProps {
  label: string;
  onCompressed: (result: CompressResult | null) => void;
}

type Status =
  | { kind: "empty" }
  | { kind: "working" }
  | {
      kind: "done";
      previewUrl: string;
      fileName: string;
      originalKb: number;
      compressedKb: number;
    }
  | { kind: "error"; message: string };

export function PhotoSlot({ label, onCompressed }: PhotoSlotProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Status>({ kind: "empty" });
  const [dragging, setDragging] = useState(false);

  // The preview URL is owned by this component, so it has to be released by
  // it too — 15 teachers x 3 photos means these add up. Kept in a ref rather
  // than read off `status` so the unmount cleanup doesn't need status as a
  // dependency (which would revoke the URL on every status change).
  const previewUrlRef = useRef<string | null>(null);

  function releasePreview() {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }

  useEffect(() => releasePreview, []);

  async function handleFile(file: File | undefined) {
    if (!file) return;

    releasePreview();
    setStatus({ kind: "working" });
    try {
      const result = await compressPhoto(file);
      // Preview the compressed blob, not the original: what is shown is then
      // literally what gets uploaded.
      const previewUrl = URL.createObjectURL(result.blob);
      previewUrlRef.current = previewUrl;
      onCompressed(result);
      setStatus({
        kind: "done",
        previewUrl,
        fileName: file.name,
        originalKb: Math.round(result.originalBytes / 1024),
        compressedKb: Math.round(result.compressedBytes / 1024),
      });
    } catch (err) {
      onCompressed(null);
      const message =
        err instanceof HeicUnsupportedError || err instanceof Error
          ? err.message
          : "Failed to process photo.";
      setStatus({ kind: "error", message });
    }
  }

  function handleRemove() {
    releasePreview();
    onCompressed(null);
    setStatus({ kind: "empty" });
    // Without this, picking the *same* file again fires no change event and
    // the slot would silently stay empty.
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-1">
      <label htmlFor={inputId} className="block text-xs text-muted-foreground">
        {label}
      </label>

      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {status.kind === "done" ? (
        <div className="relative flex items-center gap-2 rounded-md border p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={status.previewUrl}
            alt={`${label} preview`}
            className="size-12 shrink-0 rounded object-cover"
          />
          <div className="min-w-0 pr-6">
            <p className="truncate text-xs font-medium" title={status.fileName}>
              {status.fileName}
            </p>
            <p className="text-xs text-muted-foreground">
              {status.originalKb} KB → {status.compressedKb} KB
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={`Remove ${label}`}
            onClick={handleRemove}
            className="absolute top-1 right-1"
          >
            <XIcon />
          </Button>
        </div>
      ) : (
        <label
          htmlFor={inputId}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void handleFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "flex h-[4.25rem] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed p-2 text-center transition-colors hover:bg-muted/50",
            dragging && "border-primary bg-muted/50",
            status.kind === "error" && "border-destructive"
          )}
        >
          {status.kind === "working" ? (
            <>
              <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Compressing…</span>
            </>
          ) : (
            <>
              <ImageUpIcon className="size-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                Choose photo
                <span className="hidden sm:inline"> or drag here</span>
              </span>
            </>
          )}
        </label>
      )}

      {status.kind === "error" && <p className="text-xs text-destructive">{status.message}</p>}
    </div>
  );
}
