import { describe, expect, it } from "vitest";
import { describeRunModel } from "./modelIdentity";

/**
 * A subagent run records what it ran on as one string:
 * `provider/model:thinking`, for example
 * "anthropic-merchant/claude-opus-5:medium". The rows showed none of it, so a
 * fleet of running agents gave no way to tell which was on which model, or at
 * what thinking level - the two things that decide what a run costs and how
 * long it takes.
 */
describe("what a run is running on", () => {
  it("splits provider, model and thinking level", () => {
    expect(describeRunModel("anthropic-merchant/claude-opus-5:medium")).toEqual({
      provider: "anthropic-merchant",
      model: "claude-opus-5",
      thinking: "medium",
      label: "claude-opus-5 · medium",
    });
  });

  it("reads a model with no thinking level", () => {
    expect(describeRunModel("openai-codex/gpt-5.6-sol")).toEqual({
      provider: "openai-codex",
      model: "gpt-5.6-sol",
      label: "gpt-5.6-sol",
    });
  });

  it("reads a bare model id with no provider", () => {
    expect(describeRunModel("claude-opus-5:high")).toEqual({
      model: "claude-opus-5",
      thinking: "high",
      label: "claude-opus-5 · high",
    });
  });

  it("has nothing to say about a run that recorded nothing", () => {
    expect(describeRunModel(undefined)).toBeUndefined();
    expect(describeRunModel("")).toBeUndefined();
  });

  it("keeps a model id that contains a slash of its own", () => {
    // Some ids carry a path-like tail; only the first slash separates provider.
    expect(describeRunModel("vendor/family/model-1:low")?.model).toBe("family/model-1");
  });
});
