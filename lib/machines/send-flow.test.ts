import { describe, expect, it } from "vitest";
import {
  initialSendFlow,
  isSendDialogOpen,
  sendFlowReducer,
  type SendFlowEvent,
  type SendFlowState,
} from "./send-flow";

const run = (state: SendFlowState, ...events: SendFlowEvent[]) =>
  events.reduce(sendFlowReducer, state);

describe("send flow", () => {
  it("happy path: idle → confirming → sending → idle", () => {
    expect(run(initialSendFlow, { type: "open" })).toEqual({ kind: "confirming", error: null });
    expect(run(initialSendFlow, { type: "open" }, { type: "confirm" })).toEqual({ kind: "sending" });
    expect(run(initialSendFlow, { type: "open" }, { type: "confirm" }, { type: "succeeded" })).toEqual({ kind: "idle" });
  });

  it("cancel closes the confirmation", () => {
    expect(run(initialSendFlow, { type: "open" }, { type: "cancel" })).toEqual({ kind: "idle" });
  });

  it("cannot be dismissed while the request is in flight", () => {
    const sending = run(initialSendFlow, { type: "open" }, { type: "confirm" });
    expect(sendFlowReducer(sending, { type: "cancel" })).toBe(sending);
    expect(isSendDialogOpen(sending)).toBe(true);
  });

  it("a failure returns to confirming and carries the error", () => {
    const s = run(initialSendFlow, { type: "open" }, { type: "confirm" }, { type: "failed", message: "502" });
    expect(s).toEqual({ kind: "confirming", error: "502" });
    expect(isSendDialogOpen(s)).toBe(true);
  });

  it("can retry after a failure", () => {
    const s = run(initialSendFlow, { type: "open" }, { type: "confirm" }, { type: "failed", message: "502" }, { type: "confirm" });
    expect(s).toEqual({ kind: "sending" });
  });

  it("never shows a previous attempt's error when reopened", () => {
    const s = run(
      initialSendFlow,
      { type: "open" },
      { type: "confirm" },
      { type: "failed", message: "502" },
      { type: "cancel" },
      { type: "open" }
    );
    expect(s).toEqual({ kind: "confirming", error: null });
  });

  it("ignores illegal events by returning the identical state", () => {
    expect(sendFlowReducer(initialSendFlow, { type: "confirm" })).toBe(initialSendFlow);
    expect(sendFlowReducer(initialSendFlow, { type: "cancel" })).toBe(initialSendFlow);
    expect(sendFlowReducer(initialSendFlow, { type: "succeeded" })).toBe(initialSendFlow);
    expect(sendFlowReducer(initialSendFlow, { type: "failed", message: "x" })).toBe(initialSendFlow);

    const confirming = run(initialSendFlow, { type: "open" });
    expect(sendFlowReducer(confirming, { type: "open" })).toBe(confirming);
    expect(sendFlowReducer(confirming, { type: "succeeded" })).toBe(confirming);

    const sending = run(confirming, { type: "confirm" });
    expect(sendFlowReducer(sending, { type: "confirm" })).toBe(sending); // no double send
    expect(sendFlowReducer(sending, { type: "open" })).toBe(sending);
  });

  it("the dialog is open exactly when not idle", () => {
    expect(isSendDialogOpen(initialSendFlow)).toBe(false);
    expect(isSendDialogOpen({ kind: "confirming", error: null })).toBe(true);
    expect(isSendDialogOpen({ kind: "sending" })).toBe(true);
  });
});
