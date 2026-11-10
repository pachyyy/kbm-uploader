"use client";

import { useEffect, useId, useReducer, useRef, useState } from "react";
import { ImageUpIcon, Loader2Icon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { compressPhoto, type CompressResult } from "@/lib/compress";
import { initialPhotoSlot, photoSlotReducer } from "@/lib/machines/photo-slot";

interface PhotoSlotProps {
  label: string;
  onCompressed: (result: CompressResult | null) => void;
  /** Frozen while a draft run is in flight, so what is shown is what gets uploaded. */
  disabled?: boolean;
}

export function PhotoSlot({ label, onCompressed, disabled = false }: PhotoSlotProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  // The slot's states and transitions live in lib/machines/photo-slot.ts.
  const [status, dispatch] = useReducer(photoSlotReducer, initialPhotoSlot);
  const [dragging, setDragging] = useState(false);

  // Identifies the latest pick. A compression that finishes after a newer pick
  // (or after unmount) sees a different value here and discards its result.
  const pickRef = useRef(0);

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

  useEffect(
    () => () => {
      pickRef.current += 1; // invalidate any compression still in flight
      releasePreview();
    },
    []
  );

  async function handleFile(file: File | undefined) {
    if (!file || disabled) return;

    const token = ++pickRef.current;
    releasePreview();
    // The parent must stop holding the previous photo the moment a replacement
    // is picked — otherwise a run started mid-compression would upload the old
    // one while this slot says "Compressing…".
    onCompressed(null);
    dispatch({ type: "picked", token });
    try {
      const result = await compressPhoto(file);
      if (pickRef.current !== token) return; // superseded while compressing
      // Preview the compressed blob, not the original: what is shown is then
      // literally what gets uploaded.
      const previewUrl = URL.createObjectURL(result.blob);
      previewUrlRef.current = previewUrl;
      onCompressed(result);
      dispatch({
        type: "compressed",
        token,
        previewUrl,
        fileName: file.name,
        originalKb: Math.round(result.originalBytes / 1024),
        compressedKb: Math.round(result.compressedBytes / 1024),
      });
    } catch (err) {
      if (pickRef.current !== token) return;
      dispatch({
        type: "failed",
        token,
        message: err instanceof Error ? err.message : "Failed to process photo.",
      });
    }
  }

  function handleRemove() {
    releasePreview();
    onCompressed(null);
    dispatch({ type: "removed" });
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
        disabled={disabled}
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
            disabled={disabled}
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
            if (!disabled) setDragging(true);
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
            status.kind === "error" && "border-destructive",
            disabled && "cursor-not-allowed opacity-50 hover:bg-transparent"
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
