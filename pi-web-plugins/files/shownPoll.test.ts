// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { FILES_POLL_INTERVAL_MS, ShownPoll } from "./shownPoll";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ShownPoll", () => {
  it("reads every interval while shown, never off screen or in a hidden tab, and at once on coming back", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("IntersectionObserver", undefined);
    const read = vi.fn<() => void>();
    const poll = new ShownPoll(read);
    poll.start(document.createElement("div"));

    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 2);
    const whileShown = read.mock.calls.length;

    poll.reportShown(false);
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 5);
    const whileOffScreen = read.mock.calls.length - whileShown;
    poll.reportShown(true);
    const onReturn = read.mock.calls.length - whileShown;

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const hiddenFrom = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);
    const whileTabHidden = read.mock.calls.length - hiddenFrom;
    visibility.mockRestore();

    poll.stop();
    const stoppedFrom = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);
    vi.unstubAllGlobals();

    expect({ whileShown, whileOffScreen, onReturn, whileTabHidden, afterStop: read.mock.calls.length - stoppedFrom })
      .toEqual({ whileShown: 2, whileOffScreen: 0, onReturn: 1, whileTabHidden: 0, afterStop: 0 });
  });

  it("follows the page's own visibility where the page can observe it", () => {
    let report: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
    const observed: Element[] = [];
    class FakeObserver {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) { report = callback; }
      observe(target: Element): void { observed.push(target); }
      disconnect(): void { report = undefined; }
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);
    const read = vi.fn<() => void>();
    const poll = new ShownPoll(read);
    const page = document.createElement("div");
    poll.start(page);

    report?.([{ isIntersecting: false }]);
    report?.([{ isIntersecting: true }]);
    poll.stop();
    const afterStop = report;
    vi.unstubAllGlobals();

    expect({ observed: observed[0] === page, readsOnReturn: read.mock.calls.length, disconnected: afterStop === undefined }).toEqual({ observed: true, readsOnReturn: 1, disconnected: true });
  });
});
