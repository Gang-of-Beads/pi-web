import { describe, expect, it } from "vitest";
import { piWebOfferFacts, piWebUpdateOffer, withAnsweredVersion } from "./piWebUpdateOffer";

/**
 * Owner's ruling: one popup per version per machine, closing it answers it,
 * and the offer is about PI WEB - which is what carries the pi the sessions
 * actually run.
 */
describe("the offer's facts, read from a machine's pi-web/status answer", () => {
  const status = (web: Record<string, unknown>, release: Record<string, unknown>) => ({
    packageName: "@gang-of-beads/pi-web",
    generatedAt: "2026-10-01T14:09:11.652Z",
    components: { web: { component: "web", label: "Web/UI", piVersion: "0.99.2", stale: false, available: true, ...web }, sessiond: { component: "sessiond", runtimeVersion: "2.202609.1" } },
    release: { packageName: "@gang-of-beads/pi-web", checkedAt: "2026-10-01T13:41:34.536Z", ...release },
    commands: { update: "pi-web update" },
    messages: [],
  });

  it("reads the version the server compared the release against, so an available update is offered", () => {
    const facts = piWebOfferFacts(status({ runtimeVersion: "2.202609.28", installedVersion: "2.202609.28" }, { latestVersion: "2.202610.1", updateAvailable: true }));

    expect({ facts, verdict: piWebUpdateOffer({ running: facts.running, release: facts.release, answeredVersions: [] }) }).toEqual({
      facts: { running: "2.202609.28", release: { latestVersion: "2.202610.1", updateAvailable: true }, command: "pi-web update" },
      verdict: { kind: "offer", running: "2.202609.28", latest: "2.202610.1" },
    });
  });

  it("prefers the installed version, and falls back to the runtime version when none is installed", () => {
    expect([
      piWebOfferFacts(status({ runtimeVersion: "2.202609.27", installedVersion: "2.202609.28" }, {})).running,
      piWebOfferFacts(status({ runtimeVersion: "2.202609.27" }, {})).running,
    ]).toEqual(["2.202609.28", "2.202609.27"]);
  });

  it("knows nothing from an answer of another shape", () => {
    expect([piWebOfferFacts(undefined), piWebOfferFacts({ version: "1.0.0", release: "x", components: [] })]).toEqual([
      { running: undefined, release: {}, command: undefined },
      { running: undefined, release: {}, command: undefined },
    ]);
  });
});

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
