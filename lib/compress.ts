const MAX_BYTES = 450 * 1024; // headroom under SIDIA's 512 KB hard cap
const MAX_DIMENSION = 1600;
const QUALITY_STEPS = [0.9, 0.8, 0.7, 0.6, 0.5];

export class HeicUnsupportedError extends Error {
  constructor(fileName: string) {
    super(
      `"${fileName}" appears to be a HEIC/HEIF photo, which browsers cannot decode directly. Please re-export it as JPEG or PNG first (e.g. share it via WhatsApp, which converts it automatically).`
    );
    this.name = "HeicUnsupportedError";
  }
}

function looksLikeHeic(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return (
    type.includes("heic") ||
    type.includes("heif") ||
    name.endsWith(".heic") ||
    name.endsWith(".heif")
  );
}

export interface CompressResult {
  blob: Blob;
  originalBytes: number;
  compressedBytes: number;
}

/**
 * Resizes to at most MAX_DIMENSION on the long edge, then steps JPEG
 * quality down until the result is under MAX_BYTES. SIDIA enforces a hard
 * 512 KB / jpeg,jpg,png limit server-side, so this must land comfortably
 * under that or the store request will be rejected for that photo.
 */
export async function compressPhoto(file: File): Promise<CompressResult> {
  if (looksLikeHeic(file)) {
    throw new HeicUnsupportedError(file.name);
  }

  const originalBytes = file.size;

  if (originalBytes <= MAX_BYTES && (file.type === "image/jpeg" || file.type === "image/png")) {
    // Already small enough and an accepted type — skip re-encoding.
    return { blob: file, originalBytes, compressedBytes: originalBytes };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  let blob: Blob | null = null;
  for (const quality of QUALITY_STEPS) {
    blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality)
    );
    if (blob && blob.size <= MAX_BYTES) break;
  }

  if (!blob) {
    throw new Error(`Failed to encode "${file.name}" as JPEG.`);
  }
  if (blob.size > MAX_BYTES) {
    throw new Error(
      `"${file.name}" is still ${(blob.size / 1024).toFixed(0)} KB after compression (limit ~${MAX_BYTES / 1024} KB). Try a less detailed photo.`
    );
  }

  return { blob, originalBytes, compressedBytes: blob.size };
}
