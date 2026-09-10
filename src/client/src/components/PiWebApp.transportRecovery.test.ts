// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { observeTransportRecovery, reportTransportReachable } from "../api/transportHealth";
import { noticeFromError, RetiredBy } from "../notice";

afterEach(() => { observeTransportRecovery(undefined); });

/**
 * The banner a dropped connection leaves behind used to be withdrawn only when
 * the realtime socket reconnected. A failure raised by a request - a phone
 * that slept, a tunnel that blinked, a web process restarting - left the socket
 * untouched, so nothing ever disproved the message and the only way to clear it
 * was to reload the page by hand. The retirement mark, not the wording, decides.
 */
describe("a transport complaint is withdrawn by whatever succeeds next", () => {
  it("a link failure is reply-retired: the next answer disproves it", () => {
    expect(noticeFromError(new TypeError("Failed to fetch")).retiredBy).toBe(RetiredBy.reply);
    expect(noticeFromError(new TypeError("Load failed")).retiredBy).toBe(RetiredBy.reply);
  });

  it("an operation failure is reader-retired: no request can disprove it", () => {
    expect(noticeFromError(new Error("Workspace is not trusted")).retiredBy).toBe(RetiredBy.reader);
  });

  it("clears the banner when a request succeeds, without the socket reconnecting", () => {
    let errorRetiredBy: RetiredBy = RetiredBy.reply;
    observeTransportRecovery(() => { if (errorRetiredBy === RetiredBy.reply) errorRetiredBy = RetiredBy.reader; });

    reportTransportReachable("api/health");

    expect(errorRetiredBy).toBe(RetiredBy.reader);
  });

  it("leaves a real failure alone when a later request succeeds", () => {
    let errorRetiredBy: RetiredBy = RetiredBy.reader;
    observeTransportRecovery(() => { if (errorRetiredBy === RetiredBy.reply) errorRetiredBy = RetiredBy.reader; });

    reportTransportReachable("api/health");

    expect(errorRetiredBy).toBe(RetiredBy.reader);
  });
});
