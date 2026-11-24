import { describe, expect, it } from "vitest";
import { restartHasLanded, reloadOffer } from "./versionSkew";

/**
 * A tab keeps running the bundle it loaded across server upgrades, and every
 * client-side fix shipped in between reads as still broken. The offer names
 * the server version exactly when it differs; unknown answers offer nothing,
 * because absence is not evidence of staleness.
 */
describe("the reload offer", () => {
  it("offers the server version when it differs", () => {
    expect(reloadOffer("1.202609.12", "1.202609.13")).toBe("1.202609.13");
  });

  it("offers nothing when the versions agree", () => {
    expect(reloadOffer("1.202609.12", "1.202609.12")).toBeUndefined();
  });

  it("offers nothing when either side is unknown", () => {
    expect(reloadOffer("1.202609.12", undefined)).toBeUndefined();
    expect(reloadOffer("1.202609.12", "")).toBeUndefined();
    expect(reloadOffer("", "1.202609.13")).toBeUndefined();
  });

  it("treats the placeholder version as unknown rather than as an update", () => {
    expect(reloadOffer("1.202609.12", "0.0.0-dev")).toBeUndefined();
    expect(reloadOffer("0.0.0-dev", "1.202609.13")).toBeUndefined();
  });
});

describe("a restart asked from the strip", () => {
  const stale = (process: "web" | "sessiond") => ({ runtimeVersion: "2.0.0", pendingRestart: { process, installedVersion: "2.0.1", runningVersion: "2.0.0" } });

  it("has landed only once the named process is known to be current", () => {
    expect({
      webNoAnswer: restartHasLanded(undefined, "web"),
      webStillStale: restartHasLanded(stale("web"), "web"),
      webCurrentDaemonStale: restartHasLanded(stale("sessiond"), "web"),
      webCurrent: restartHasLanded({ runtimeVersion: "2.0.1" }, "web"),
      daemonStillStale: restartHasLanded(stale("sessiond"), "sessiond"),
      daemonDown: restartHasLanded({ runtimeVersion: "2.0.1", sessiondUnavailable: true }, "sessiond"),
      daemonCurrent: restartHasLanded({ runtimeVersion: "2.0.1" }, "sessiond"),
      webRestartWhileDaemonDown: restartHasLanded({ runtimeVersion: "2.0.1", sessiondUnavailable: true }, "web"),
    }).toEqual({ webNoAnswer: false, webStillStale: false, webCurrentDaemonStale: true, webCurrent: true, daemonStillStale: false, daemonDown: false, daemonCurrent: true, webRestartWhileDaemonDown: true });
  });
});
