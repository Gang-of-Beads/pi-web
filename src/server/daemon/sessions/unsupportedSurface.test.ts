import { describe, expect, it, vi } from "vitest";

import { announceUnsupportedSurface, withUnsupportedSurfaceAnnouncement } from "./unsupportedSurface";

/**
 * An extension asking for a screen this browser cannot draw was answered with
 * a silent cancel: the pi updater asked through ui.custom every session,
 * every answer evaporated, and the prompt returned each time with nothing
 * anywhere saying why. The cancel is still the right answer - the browser
 * truly cannot draw it - but it has to be said out loud.
 */
describe("a UI surface the browser cannot draw", () => {
  it("says so before cancelling, once per ask", () => {
    const announced: string[] = [];
    const base = vi.fn((...args: unknown[]) => Promise.resolve(args));
    const wrapped = withUnsupportedSurfaceAnnouncement(base, () => { announced.push(announceUnsupportedSurface("custom")); });

    void wrapped("component", {});
    void wrapped("component", {});

    expect(base).toHaveBeenCalledTimes(2);
    expect(announced).toHaveLength(2);
    expect(announced[0]).toContain("ui.custom");
  });

  it("still returns the base's cancel-safe answer", async () => {
    const base = vi.fn(() => Promise.resolve("cancelled"));
    const wrapped = withUnsupportedSurfaceAnnouncement(base, () => { /* the announcement is not what this test watches */ });

    await expect(wrapped()).resolves.toBe("cancelled");
  });
});
