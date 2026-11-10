import { describe, expect, it } from "vitest";
import { uploadPhase } from "./upload-phase";

describe("uploadPhase", () => {
  it("is loading until teachers arrive, unless the load failed", () => {
    expect(uploadPhase({ teachersLoaded: false, loadError: null, mappingDone: false })).toBe("loading");
    expect(uploadPhase({ teachersLoaded: false, loadError: "502", mappingDone: false })).toBe("load_error");
  });

  it("needs mapping once teachers are known but not all assigned", () => {
    expect(uploadPhase({ teachersLoaded: true, loadError: null, mappingDone: false })).toBe("needs_mapping");
  });

  it("is ready when every teacher is assigned", () => {
    expect(uploadPhase({ teachersLoaded: true, loadError: null, mappingDone: true })).toBe("ready");
  });

  it("does not show an error over teachers that are already on screen (e.g. from cache)", () => {
    expect(uploadPhase({ teachersLoaded: true, loadError: "offline", mappingDone: true })).toBe("ready");
    expect(uploadPhase({ teachersLoaded: true, loadError: "offline", mappingDone: false })).toBe("needs_mapping");
  });
});
