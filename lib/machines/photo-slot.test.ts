import { describe, expect, it } from "vitest";
import {
  initialPhotoSlot,
  photoSlotReducer,
  type PhotoSlotEvent,
  type PhotoSlotState,
} from "./photo-slot";

const run = (state: PhotoSlotState, ...events: PhotoSlotEvent[]) =>
  events.reduce(photoSlotReducer, state);

const compressed = (token: number, fileName = "a.jpg"): PhotoSlotEvent => ({
  type: "compressed",
  token,
  previewUrl: `blob:${fileName}`,
  fileName,
  originalKb: 900,
  compressedKb: 300,
});

describe("photo slot", () => {
  it("empty → working → done", () => {
    expect(run(initialPhotoSlot, { type: "picked", token: 1 })).toEqual({ kind: "working", token: 1 });
    expect(run(initialPhotoSlot, { type: "picked", token: 1 }, compressed(1))).toEqual({
      kind: "done",
      previewUrl: "blob:a.jpg",
      fileName: "a.jpg",
      originalKb: 900,
      compressedKb: 300,
    });
  });

  it("working → error, and a new pick recovers from it", () => {
    const err = run(initialPhotoSlot, { type: "picked", token: 1 }, { type: "failed", token: 1, message: "HEIC" });
    expect(err).toEqual({ kind: "error", message: "HEIC" });
    expect(run(err, { type: "picked", token: 2 })).toEqual({ kind: "working", token: 2 });
  });

  it("a newer pick wins over a slower, earlier compression", () => {
    // pick A (token 1), pick B (token 2), B finishes first, then A finishes late
    const s = run(
      initialPhotoSlot,
      { type: "picked", token: 1 },
      { type: "picked", token: 2 },
      compressed(2, "b.jpg"),
      compressed(1, "a.jpg")
    );
    expect(s).toMatchObject({ kind: "done", fileName: "b.jpg" });
  });

  it("ignores a late failure from a superseded pick", () => {
    const s = run(
      initialPhotoSlot,
      { type: "picked", token: 1 },
      { type: "picked", token: 2 },
      { type: "failed", token: 1, message: "stale" }
    );
    expect(s).toEqual({ kind: "working", token: 2 });
  });

  it("ignores a result that arrives after the slot was emptied", () => {
    const done = run(initialPhotoSlot, { type: "picked", token: 1 }, compressed(1));
    const s = run(done, { type: "removed" }, compressed(1));
    expect(s).toEqual({ kind: "empty" });
  });

  it("removed empties a done or error slot, and does nothing while working or empty", () => {
    expect(run(initialPhotoSlot, { type: "picked", token: 1 }, compressed(1), { type: "removed" })).toEqual({ kind: "empty" });
    expect(run(initialPhotoSlot, { type: "picked", token: 1 }, { type: "failed", token: 1, message: "x" }, { type: "removed" })).toEqual({ kind: "empty" });

    const working = run(initialPhotoSlot, { type: "picked", token: 1 });
    expect(photoSlotReducer(working, { type: "removed" })).toBe(working);
    expect(photoSlotReducer(initialPhotoSlot, { type: "removed" })).toBe(initialPhotoSlot);
  });

  it("replacing a done photo goes back through working", () => {
    const done = run(initialPhotoSlot, { type: "picked", token: 1 }, compressed(1));
    expect(run(done, { type: "picked", token: 2 })).toEqual({ kind: "working", token: 2 });
  });
});
