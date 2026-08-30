import { describe, expect, it } from "vitest";
import { StatusBar } from "./StatusBar";

/**
 * Warnings file in the notification drawer now; the status bar's warning
 * counter and toggle went with the transcript-top cards. The property probe
 * pins the deletion so a revival cannot land silently.
 */
describe("deleted status-bar warning toggle stays deleted", () => {
  it("exposes no warning count or toggle surface", () => {
    const statusBar = new StatusBar();
    expect(Reflect.get(statusBar, "warningCount")).toBeUndefined();
    expect(Reflect.get(statusBar, "onToggleWarnings")).toBeUndefined();
  });
});
