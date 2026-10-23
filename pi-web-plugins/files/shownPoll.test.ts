// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { FILES_POLL_INTERVAL_MS, ShownPoll } from "./shownPoll";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("ShownPoll", () => {
  it("reads every interval while shown, never while hidden, and at once on coming back", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => void>();
    const poll = new ShownPoll(read);
    poll.start(true);

    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 2);
    const whileShown = read.mock.calls.length;

    poll.reportShown(false);
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 5);
    const whileHidden = read.mock.calls.length - whileShown;
    poll.reportShown(true);
    const onReturn = read.mock.calls.length - whileShown;
    poll.reportShown(true);
    const onRepeatedReport = read.mock.calls.length - whileShown - onReturn;

    poll.stop();
    const stoppedFrom = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);

    expect({ whileShown, whileHidden, onReturn, onRepeatedReport, afterStop: read.mock.calls.length - stoppedFrom })
      .toEqual({ whileShown: 2, whileHidden: 0, onReturn: 1, onRepeatedReport: 0, afterStop: 0 });
  });

  it("follows the host's answer from the start: a page opened hidden waits, and reads once it is shown", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => void>();
    const poll = new ShownPoll(read);
    poll.start(false);

    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);
    const whileHidden = read.mock.calls.length;
    poll.reportShown(true);
    const readsOnShown = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS);
    poll.stop();

    expect({ whileHidden, readsOnShown, afterOneInterval: read.mock.calls.length }).toEqual({ whileHidden: 0, readsOnShown: 1, afterOneInterval: 2 });
  });

  it("ignores a shown report that arrives after it stopped", async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => void>();
    const poll = new ShownPoll(read);
    poll.start(true);
    poll.reportShown(false);
    poll.stop();

    poll.reportShown(true);
    await vi.advanceTimersByTimeAsync(FILES_POLL_INTERVAL_MS * 3);

    expect(read).not.toHaveBeenCalled();
  });
});
