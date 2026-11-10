/**
 * The "Send to penyuluh" confirmation flow shared by the upload page and the
 * Riwayat modal. Finalizing is outward-facing and cannot be undone, so the
 * flow always passes through `confirming`, and cannot be dismissed while the
 * request is in flight.
 *
 *   idle ──open──▶ confirming ──confirm──▶ sending ──succeeded──▶ idle
 *                     │  ▲                    │
 *                     │  └──────failed────────┘   (back to confirming, carrying the error)
 *                     └──cancel──▶ idle
 *
 * The dialog is open exactly when the state is not `idle`.
 */
export type SendFlowState =
  | { kind: "idle" }
  | { kind: "confirming"; error: string | null }
  | { kind: "sending" };

export type SendFlowEvent =
  | { type: "open" }
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "succeeded" }
  | { type: "failed"; message: string };

export const initialSendFlow: SendFlowState = { kind: "idle" };

/** Illegal events return the same state object. */
export function sendFlowReducer(state: SendFlowState, event: SendFlowEvent): SendFlowState {
  switch (event.type) {
    case "open":
      // A fresh open never shows the previous attempt's error.
      return state.kind === "idle" ? { kind: "confirming", error: null } : state;
    case "cancel":
      return state.kind === "confirming" ? { kind: "idle" } : state;
    case "confirm":
      return state.kind === "confirming" ? { kind: "sending" } : state;
    case "succeeded":
      return state.kind === "sending" ? { kind: "idle" } : state;
    case "failed":
      return state.kind === "sending" ? { kind: "confirming", error: event.message } : state;
  }
}

export const isSendDialogOpen = (state: SendFlowState) => state.kind !== "idle";
