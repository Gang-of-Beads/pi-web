// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { observeTransportRecovery, reportTransportReachable } from "../api/transportHealth";
import { isTransientError } from "./errorBanner";

afterEach(() => { observeTransportRecovery(undefined); });

/**
 * The banner a dropped connection leaves behind used to be withdrawn only when
 * the realtime socket reconnected. A failure raised by a request - a phone
 * that slept, a tunnel that blinked, a web process restarting - left the socket
 * untouched, so nothing ever disproved the message and the only way to clear it
 * was to reload the page by hand.
 */
describe("a transport complaint is withdrawn by whatever succeeds next", () => {
  it("recognises the message a dropped fetch leaves as self-healing", () => {
    // Chrome, Safari and Firefox each word it differently; all three heal.
    expect(isTransientError("Failed to fetch")).toBe(true);
    expect(isTransientError("Load failed")).toBe(true);
    expect(isTransientError("NetworkError when attempting to fetch resource")).toBe(true);
  });

  it("keeps a real failure on screen", () => {
    expect(isTransientError("Workspace is not trusted")).toBe(false);
  });

  it("clears the banner when a request succeeds, without the socket reconnecting", () => {
    let error = "Failed to fetch";
    observeTransportRecovery(() => { if (isTransientError(error)) error = ""; });

    reportTransportReachable();

    expect(error).toBe("");
  });

  it("leaves a real failure alone when a later request succeeds", () => {
    let error = "Workspace is not trusted";
    observeTransportRecovery(() => { if (isTransientError(error)) error = ""; });

    reportTransportReachable();

    expect(error).toBe("Workspace is not trusted");
  });
});
