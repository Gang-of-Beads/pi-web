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

/**
 * The 5c ruling: the queued message's gold card is the one representation of
 * the queue, position included, and nothing counts the queue twice - the
 * cards are the count. The status bar's "N queued" was a producer the
 * original sweep missed, reported live as a third way of writing "queued".
 */
describe("the status bar does not count the queue", () => {
  it("renders no queued counter from the session status", () => {
    const sheetAndTemplate = StatusBar.prototype.render.toString();
    expect(sheetAndTemplate).not.toMatch(/queued/iu);
  });
});
