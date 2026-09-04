import { describe, expect, it, vi } from "vitest";
import { createPluginHostUi } from "./pluginHostUi";
import { COARSE_OR_MOBILE_MEDIA_QUERY, DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY, MOBILE_NAVIGATION_MEDIA_QUERY } from "../breakpoints";
import { interactiveSurfaceStyles } from "../components/shared";
import { describeError } from "../notice";
import { PluginRegistry } from "./registry";
import type { PiWebPlugin, PluginHostUi } from "./types";

describe("the host utilities handed to plugins", () => {
  it("hands out the host's own breakpoints, not copies of the numbers", () => {
    const ui = createPluginHostUi();

    expect(ui.breakpoints).toEqual({
      coarseOrMobile: COARSE_OR_MOBILE_MEDIA_QUERY,
      mobileNavigation: MOBILE_NAVIGATION_MEDIA_QUERY,
      desktopSideBySide: DESKTOP_SIDE_BY_SIDE_MEDIA_QUERY,
    });
  });

  it("hands out the host's own surface styles and error wording", () => {
    const ui = createPluginHostUi();

    expect(ui.surfaceStyles).toBe(interactiveSurfaceStyles);
    expect(ui.describeError).toBe(describeError);
    expect(ui.describeError(new Error("refused"))).toBe(describeError(new Error("refused")));
  });

  it("copies through the host's clipboard chain", async () => {
    const ui = createPluginHostUi();
    const clipboard = { writeText: vi.fn(() => Promise.resolve()) };
    vi.stubGlobal("navigator", { clipboard });
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("window", { isSecureContext: true, navigator: { clipboard } });
    try {
      await expect(ui.copyText("hello")).resolves.toBe(true);
      expect(clipboard.writeText).toHaveBeenCalledWith("hello");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reaches a plugin through its activation context", () => {
    const seen: (PluginHostUi | undefined)[] = [];
    const plugin: PiWebPlugin = {
      apiVersion: 2,
      name: "Terminal",
      activate: (context) => { seen.push(context.ui); return { contributions: {} }; },
    };
    const ui = createPluginHostUi();

    new PluginRegistry({ ui }).register({ id: "terminal", plugin });

    expect(seen[0]).toBe(ui);
  });

  it("is absent rather than faked on a host that offers none", () => {
    const seen: (PluginHostUi | undefined)[] = [];
    const plugin: PiWebPlugin = {
      apiVersion: 2,
      name: "Terminal",
      activate: (context) => { seen.push(context.ui); return { contributions: {} }; },
    };

    new PluginRegistry().register({ id: "terminal", plugin });

    expect(seen[0]).toBeUndefined();
  });
});
