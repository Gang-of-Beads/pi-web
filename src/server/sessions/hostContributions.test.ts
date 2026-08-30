import { describe, expect, it } from "vitest";
import { EMPTY_HOST_CONTRIBUTIONS, describeHostContributions } from "./hostContributions.js";
import { piWebResourceLoaderOptions } from "./piSessionService.js";

describe("the host contribution seam", () => {
  /**
   * Task 1.1: a contribution that did not go through the seam cannot reach
   * the model. The seam is the only thing `piWebResourceLoaderOptions`
   * reads - construct the loader with an empty seam while "contributions"
   * exist elsewhere (here: the arguments a caller might hope would leak in)
   * and the loader stays silent.
   */
  it("leaves the loader untouched when the seam is empty", () => {
    expect(piWebResourceLoaderOptions(EMPTY_HOST_CONTRIBUTIONS.systemPromptSections)).toBeUndefined();
  });

  it("carries seam-registered sections and nothing else", () => {
    const loader = piWebResourceLoaderOptions(["<pi_web_session_environment>x</pi_web_session_environment>"]);
    expect(loader).toBeDefined();
    const override = loader?.appendSystemPromptOverride;
    if (override === undefined) throw new Error("expected an override");
    expect(override(["operator.md"])).toEqual(["operator.md", "<pi_web_session_environment>x</pi_web_session_environment>"]);
  });

  /**
   * Task 1.2: the deviation list is derived from the seam as data. Today's
   * daemon registers the environment sections and the one unsupported
   * surface; the test asserts the shapes without naming either by hand.
   */
  it("derives the deviation list from the contributions", () => {
    const daemonShape = {
      systemPromptSections: ["<pi_web_session_environment>x</pi_web_session_environment>", "<pi_web_docker_environment>y</pi_web_docker_environment>"],
      unsupportedSurfaces: ["custom"],
    };
    const rows = describeHostContributions(daemonShape);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.kind === "prompt-addition")).toHaveLength(2);
    expect(rows.filter((row) => row.kind === "surface-interception")).toHaveLength(1);
    expect(describeHostContributions(EMPTY_HOST_CONTRIBUTIONS)).toEqual([]);
  });
});
