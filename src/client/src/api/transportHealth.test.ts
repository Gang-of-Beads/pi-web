// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { observeTransportRecovery, reportTransportReachable } from "./transportHealth";

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

    reportTransportReachable();

    expect(onRecovered).toHaveBeenCalledOnce();
  });

  it("stops telling a listener that has been withdrawn", () => {
    const onRecovered = vi.fn();
    observeTransportRecovery(onRecovered);
    observeTransportRecovery(undefined);

    reportTransportReachable();

    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("survives a listener that throws, so one bad observer cannot break requests", () => {
    observeTransportRecovery(() => { throw new Error("listener blew up"); });

    expect(() => { reportTransportReachable(); }).not.toThrow();
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

  it("does not report when the server answers with a failure", async () => {
    const onRecovered = vi.fn();
    observeTransportRecovery(onRecovered);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: () => Promise.resolve({}),
    }));

    const { request } = await import("./http");
    await request("api/probe", (value) => value).catch(() => undefined);

    expect(onRecovered).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
