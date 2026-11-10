/**
 * One photo slot: pick → compress → preview. Every pick gets a `token`, and a
 * compression result is only accepted if it carries the token of the pick that
 * is still current. That is what stops a slow compression of an earlier file
 * from overwriting a later pick (and leaking its preview URL).
 *
 *   empty ──picked──▶ working ──compressed──▶ done
 *     ▲                  │  ╲                   │
 *     │                  │   ╲──failed──▶ error │
 *     └──────────────────┴──────removed─────────┘   (picked works from any state)
 *
 * Results whose token no longer matches are ignored.
 */
export type PhotoSlotState =
  | { kind: "empty" }
  | { kind: "working"; token: number }
  | {
      kind: "done";
      previewUrl: string;
      fileName: string;
      originalKb: number;
      compressedKb: number;
    }
  | { kind: "error"; message: string };

export type PhotoSlotEvent =
  | { type: "picked"; token: number }
  | {
      type: "compressed";
      token: number;
      previewUrl: string;
      fileName: string;
      originalKb: number;
      compressedKb: number;
    }
  | { type: "failed"; token: number; message: string }
  | { type: "removed" };

export const initialPhotoSlot: PhotoSlotState = { kind: "empty" };

export function photoSlotReducer(state: PhotoSlotState, event: PhotoSlotEvent): PhotoSlotState {
  switch (event.type) {
    case "picked":
      return { kind: "working", token: event.token };
    case "compressed": {
      if (state.kind !== "working" || state.token !== event.token) return state;
      return {
        kind: "done",
        previewUrl: event.previewUrl,
        fileName: event.fileName,
        originalKb: event.originalKb,
        compressedKb: event.compressedKb,
      };
    }
    case "failed":
      if (state.kind !== "working" || state.token !== event.token) return state;
      return { kind: "error", message: event.message };
    case "removed":
      return state.kind === "done" || state.kind === "error" ? { kind: "empty" } : state;
  }
}
