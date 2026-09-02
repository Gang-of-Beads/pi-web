import { describe, expect, it } from "vitest";
import { pluginSurfaceVisibility } from "./pluginSurfaceVisibility.js";

const empty = { hasContent: false, loading: false, loadFailed: false };

describe("whether a plugin-backed panel belongs on screen", () => {
  it("hides a surface nothing provides", () => {
    expect(pluginSurfaceVisibility({ ...empty, presence: "absent" })).toEqual({ show: false, reason: "not-installed" });
  });

  /**
   * Absence of an answer is not an answer. A daemon that predates the field, or
   * a runtime that cannot enumerate its extensions, must not cost the reader a
   * panel that works.
   */
  it("keeps a surface whose presence is unknown", () => {
    expect(pluginSurfaceVisibility({ ...empty, presence: undefined })).toEqual({ show: true, reason: "presence-unknown" });
  });

  /** A broken install is worth seeing; tidying it away as "not installed" is not. */
  it("keeps a surface whose plugin failed to load", () => {
    expect(pluginSurfaceVisibility({ ...empty, presence: "failed" })).toEqual({ show: true, reason: "plugin-failed" });
  });

  it("keeps an installed surface that has nothing in it yet", () => {
    expect(pluginSurfaceVisibility({ ...empty, presence: "present" }).show).toBe(true);
  });

  it("keeps a surface that has content whatever the runtime says", () => {
    expect(pluginSurfaceVisibility({ ...empty, hasContent: true, presence: "absent" })).toEqual({ show: true, reason: "has-content" });
  });

  /** Hiding the panel mid-read is how a loading state went unseen for its whole life. */
  it("keeps a surface that is still being read", () => {
    expect(pluginSurfaceVisibility({ ...empty, loading: true, presence: "absent" })).toEqual({ show: true, reason: "loading" });
  });

  it("keeps a surface whose read failed, so the failure can be reported", () => {
    expect(pluginSurfaceVisibility({ ...empty, loadFailed: true, presence: "absent" })).toEqual({ show: true, reason: "load-failed" });
  });
});
