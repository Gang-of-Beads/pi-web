// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http";
import { machineIdFromUrl, observeTransportRecovery, reportTransportReachable } from "./transportHealth";

beforeEach(() => { observeTransportRecovery(undefined); });

/**
 * A connection error is raised by whichever channel happened to fail, and
 * recovery is noticed by whichever channel happens to succeed next. Those are
 * not the same channel: the banner was withdrawn only when the realtime socket
 * reconnected, so a failure raised by a request that later succeeded stayed on
 * screen until the page was reloaded by hand.
 *
 * Any successful exchange with the server is proof the transport is back,
 * whichever one it was.
 */
describe("transport recovery", () => {
  it("tells the listener when the server has been reached again", () => {
    const onRecovered = vi.fn();
    observeTransportRecovery(onRecovered);

    reportTransportReachable("api/health");

    expect(onRecovered).toHaveBeenCalledOnce();
  });

  it("stops telling a listener that has been withdrawn", () => {
    const onRecovered = vi.fn();
    observeTransportRecovery(onRecovered);
    observeTransportRecovery(undefined);

    reportTransportReachable("api/health");

    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("survives a listener that throws, so one bad observer cannot break requests", () => {
    observeTransportRecovery(() => { throw new Error("listener blew up"); });

    expect(() => { reportTransportReachable("api/health"); }).not.toThrow();
  });
});

/**
 * The observer above is only useful if the request boundary actually reports
 * through it. Asserting the observer in isolation passed even with the call
 * removed from `request`, which is exactly the kind of green that hides a
 * disconnected wire.
 */
describe("the request boundary reports reachability", () => {
  it("reports after a successful request", async () => {
    const onRecovered = vi.fn();
    observeTransportRecovery(onRecovered);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ value: 1 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await import("./http");
    await request("api/probe", (value) => value);

    expect(onRecovered).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it("reports reachability even when the server answers with a failure: a 500 still disproves that the link is down", async () => {
    const onRecovered = vi.fn();
    observeTransportRecovery(onRecovered);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: () => Promise.resolve({}),
    }));

    const { request } = await import("./http");
    await expect(request("api/probe", (value) => value)).rejects.toBeInstanceOf(HttpError);

    expect(onRecovered).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});

describe("machineIdFromUrl", () => {
  it("names the machine a machine-owned URL speaks about", () => {
    expect(machineIdFromUrl("api/machines/remote-a/status")).toBe("remote-a");
    expect(machineIdFromUrl("api/machines/lab%20mac/health")).toBe("lab mac");
  });

  it("gives no machine for a web-owned URL", () => {
    expect(machineIdFromUrl("api/status")).toBeUndefined();
    expect(machineIdFromUrl("api/pi-web/fleet")).toBeUndefined();
  });

  it("survives a malformed escape: a broken URL is not a thrown report", () => {
    expect(machineIdFromUrl("api/machines/%ZZ/status")).toBe("%ZZ");
  });
});
