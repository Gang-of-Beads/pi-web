import { describe, expect, it } from "vitest";
import type { PiWebComponentStatus, PiWebReleaseStatus, PiWebStatusResponse } from "@gang-of-beads/pi-web/plugin-api";
import { answeredVersionsFrom, piWebOfferFacts, piWebUpdateOffer, withAnsweredVersion } from "./piWebUpdateOffer";

/** The answer shape is the plugin API's own type, so a change to it on the server breaks this file's typecheck. */
describe("the offer's facts, read from a machine's pi-web/status answer", () => {
  const status = (web: Partial<PiWebComponentStatus>, release: Partial<PiWebReleaseStatus>) => ({
    packageName: "@gang-of-beads/pi-web",
    generatedAt: "2026-10-01T14:09:11.652Z",
    components: {
      web: { component: "web", label: "Web/UI", stale: false, available: true, ...web },
      sessiond: { component: "sessiond", label: "Session daemon", runtimeVersion: "2.202609.1", stale: false, available: true },
    },
    release: { packageName: "@gang-of-beads/pi-web", updateAvailable: false, checkedAt: "2026-10-01T13:41:34.536Z", ...release },
    commands: { update: "pi-web update" },
    messages: [],
  }) satisfies PiWebStatusResponse;

  it("reads the version the server compared the release against, so an available update is offered", () => {
    const facts = piWebOfferFacts(status({ runtimeVersion: "2.202609.28", installedVersion: "2.202609.28" }, { latestVersion: "2.202610.1", updateAvailable: true }));

    expect({ facts, verdict: piWebUpdateOffer({ running: facts.running, release: facts.release, answeredVersions: [] }) }).toEqual({
      facts: { running: "2.202609.28", release: { latestVersion: "2.202610.1", updateAvailable: true } },
      verdict: { kind: "offer", running: "2.202609.28", latest: "2.202610.1" },
    });
  });

  it("prefers the installed version, and falls back to the runtime version when none is installed", () => {
    expect([
      piWebOfferFacts(status({ runtimeVersion: "2.202609.27", installedVersion: "2.202609.28" }, {})).running,
      piWebOfferFacts(status({ runtimeVersion: "2.202609.27" }, {})).running,
    ]).toEqual(["2.202609.28", "2.202609.27"]);
  });

  it("reads the answered versions, and none from an answer of another shape", () => {
    expect([answeredVersionsFrom({ answeredVersions: ["2.202609.9", 3, "2.202610.1"] }), answeredVersionsFrom({ answeredVersions: "x" }), answeredVersionsFrom(undefined)])
      .toEqual([["2.202609.9", "2.202610.1"], [], []]);
  });

  it("knows nothing from an answer of another shape", () => {
    expect([piWebOfferFacts(undefined), piWebOfferFacts({ version: "1.0.0", release: "x", components: [] })]).toEqual([
      { running: undefined, release: {} },
      { running: undefined, release: {} },
    ]);
  });
});

/**
 * Owner's ruling: one popup per version per machine, closing it answers it,
 * and the offer is about PI WEB - which is what carries the pi the sessions
 * actually run.
 */
describe("the PI WEB update offer", () => {
  it("offers an available version nobody has answered", () => {
    expect(piWebUpdateOffer({
      running: "2.202609.6",
      release: { latestVersion: "2.202609.7", updateAvailable: true },
      answeredVersions: [],
    })).toEqual({ kind: "offer", running: "2.202609.6", latest: "2.202609.7" });
  });

  it("stays quiet when the machine reports no update", () => {
    expect(piWebUpdateOffer({
      running: "2.202609.7",
      release: { latestVersion: "2.202609.7", updateAvailable: false },
      answeredVersions: [],
    })).toEqual({ kind: "none", reason: "up-to-date" });
  });

  it("stays quiet about a version this machine already answered", () => {
    expect(piWebUpdateOffer({
      running: "2.202609.6",
      release: { latestVersion: "2.202609.7", updateAvailable: true },
      answeredVersions: ["2.202609.7"],
    })).toEqual({ kind: "none", reason: "answered" });
  });

  it("says it does not know rather than claiming up to date", () => {
    expect(piWebUpdateOffer({ running: undefined, release: { latestVersion: "2.202609.7", updateAvailable: true }, answeredVersions: [] }))
      .toEqual({ kind: "none", reason: "unknown-release" });
    expect(piWebUpdateOffer({ running: "2.202609.6", release: undefined, answeredVersions: [] }))
      .toEqual({ kind: "none", reason: "unknown-release" });
  });

  it("offers again when a newer version appears", () => {
    const answered = withAnsweredVersion([], "2.202609.7");
    expect(piWebUpdateOffer({ running: "2.202609.6", release: { latestVersion: "2.202609.8", updateAvailable: true }, answeredVersions: answered }))
      .toMatchObject({ kind: "offer", latest: "2.202609.8" });
  });

  it("keeps one entry per version and bounds what it remembers", () => {
    expect(withAnsweredVersion(["a", "b"], "a")).toEqual(["b", "a"]);
    expect(withAnsweredVersion(Array.from({ length: 20 }, (_, index) => `v${String(index)}`), "next").length).toBe(16);
  });
});
