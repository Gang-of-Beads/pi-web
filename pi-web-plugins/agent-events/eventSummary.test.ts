import { describe, expect, it } from "vitest";
import { agentEventSummary } from "./eventSummary";

describe("agentEventSummary", () => {
  it("counts the sources a web search read and names the first", () => {
    expect(agentEventSummary("web-search-results", { urlMetadata: [{ url: "https://a", title: "A" }, { url: "https://b" }] }))
      .toEqual({ title: "Web search", detail: "2 sources · A" });
  });

  it("names a browser session and its cleanup state", () => {
    expect(agentEventSummary("agent-browser-script-session", { sessionName: "piab-1", cleanup: "active" }).detail)
      .toBe("piab-1 · active");
  });

  it("lists only the providers that actually chose an account", () => {
    expect(agentEventSummary("pi-accounts-selection", { providers: { anthropic: "merchant", xai: null } }).detail)
      .toBe("anthropic: merchant");
  });

  it("says nothing it was not given", () => {
    expect(agentEventSummary("web-search-results", undefined).detail).toBeUndefined();
    expect(agentEventSummary("pi-accounts-selection", { providers: {} }).detail).toBeUndefined();
    expect(agentEventSummary("something-else", {})).toEqual({ title: "Agent event", detail: undefined });
  });
});
