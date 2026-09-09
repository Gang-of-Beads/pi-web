// @vitest-environment node

import { afterEach, describe, expect, it } from "vitest";
import { lazySurfacesStarted, loadSurface, resetLazySurfaces, trackLoad, warmLazySurfaces } from "./lazySurfaces.js";

afterEach(() => { resetLazySurfaces(); });

/**
 * These surfaces are loaded, not merely declared. A regression here is silent:
 * the app still boots, and the dialog simply never appears.
 */
describe("surfaces that load when they are opened", () => {
  it("loads a surface once, however many times it is opened", async () => {
    const first = loadSurface("settings");
    const second = loadSurface("settings");
    expect(second).toBe(first);
    await first;
    expect(lazySurfacesStarted()).toEqual(["settings"]);
  });

  it("warms every surface on the schedule it is given", () => {
    const scheduled: (() => void)[] = [];
    warmLazySurfaces((task) => { scheduled.push(task); });
    expect(scheduled).toHaveLength(1);
    expect(lazySurfacesStarted()).toEqual([]);

    scheduled[0]?.();
    expect([...lazySurfacesStarted()].sort()).toEqual(["quick-switcher", "session-tree", "settings"]);
  });

  it("forgets a failed load so the next open can retry", async () => {
    const loads = new Map<string, Promise<void>>();
    const failed = trackLoad(loads, "settings", Promise.reject(new Error("chunk is gone")));
    expect(loads.has("settings")).toBe(true);
    await expect(failed).rejects.toThrow("chunk is gone");
    expect(loads.has("settings")).toBe(false);
  });

  it("keeps a load that succeeded", async () => {
    const loads = new Map<string, Promise<void>>();
    await trackLoad(loads, "settings", Promise.resolve());
    expect(loads.has("settings")).toBe(true);
  });

  it("resolves each surface to a defined custom element", async () => {
    await Promise.all([loadSurface("settings"), loadSurface("quick-switcher"), loadSurface("session-tree")]);
    expect(lazySurfacesStarted()).toHaveLength(3);
  });
});
