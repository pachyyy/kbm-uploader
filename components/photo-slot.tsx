"use client";

import { useState } from "react";
import { compressPhoto, HeicUnsupportedError, type CompressResult } from "@/lib/compress";

interface PhotoSlotProps {
  label: string;
  onCompressed: (result: CompressResult | null) => void;
}

export function PhotoSlot({ label, onCompressed }: PhotoSlotProps) {
  const [status, setStatus] = useState<
    | { kind: "empty" }
    | { kind: "working" }
    | { kind: "done"; originalKb: number; compressedKb: number }
    | { kind: "error"; message: string }
  >({ kind: "empty" });

  async function handleFile(file: File | undefined) {
    if (!file) {
      onCompressed(null);
      setStatus({ kind: "empty" });
      return;
    }
    setStatus({ kind: "working" });
    try {
      const result = await compressPhoto(file);
      onCompressed(result);
      setStatus({
        kind: "done",
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

  return (
    <div className="space-y-1">
      <label className="block text-xs text-muted-foreground">{label}</label>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => handleFile(e.target.files?.[0])}
        className="block w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1 file:text-xs"
      />
      {status.kind === "working" && (
        <p className="text-xs text-muted-foreground">Compressing…</p>
      )}
      {status.kind === "done" && (
        <p className="text-xs text-green-600">
          {status.originalKb} KB → {status.compressedKb} KB
        </p>
      )}
      {status.kind === "error" && (
        <p className="text-xs text-destructive">{status.message}</p>
      )}
    </div>
  );
}
