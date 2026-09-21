import { describe, expect, it } from "vitest";
import { piWebUpdateOffer, withAnsweredVersion } from "./piWebUpdateOffer";

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
