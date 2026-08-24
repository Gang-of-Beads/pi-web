// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import type { SessionActivity, SessionStatus } from "../../../shared/apiTypes";
import { backgroundWorkLabel, ChatView } from "./ChatView";

function status(over: Partial<SessionStatus>): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...over,
  };
}

function activity(phase: SessionActivity["phase"], label = "Working"): SessionActivity {
  return { sessionId: "s", phase, label, at: "" };
}

async function dockWith(status: SessionStatus | undefined, activity: SessionActivity | undefined): Promise<{ dots: NodeListOf<Element>; dot: Element | null; className: string; text: string }> {
  const view = new ChatView();
  view.sessionId = "s";
  if (status !== undefined) view.status = status;
  if (activity !== undefined) view.activity = activity;
  document.body.append(view);
  await view.updateComplete;
  const host = view.renderRoot;
  const dock = host.querySelector(".activity-dock");
  return {
    dots: host.querySelectorAll(".state-dot"),
    dot: host.querySelector(".activity-dock .dot"),
    className: dock?.getAttribute("class") ?? "",
    text: host.querySelector(".activity-text")?.textContent ?? "",
  };
}

describe("ChatView activity dock states", () => {
  it("shows three bouncing dots while streaming", async () => {
    const dock = await dockWith(status({ isStreaming: true }), activity("active"));
    expect(dock.className).toContain("working");
    expect(dock.dots.length).toBe(3);
  });

  it("shows a static green dot when idle", async () => {
    const dock = await dockWith(status({}), activity("idle"));
    expect(dock.className).toContain("idle");
    expect(dock.dots.length).toBe(0);
    expect(dock.dot).not.toBeNull();
  });

  it("shows an amber dot and waiting text while an ask is open", async () => {
    const dock = await dockWith(status({ pendingAsk: { askId: "a", askedAt: "", questions: [] } }), activity("idle"));
    expect(dock.className).toContain("asking");
    expect(dock.dots.length).toBe(0);
    expect(dock.dot).not.toBeNull();
  });

  it("shows an error state when the activity phase errored", async () => {
    const dock = await dockWith(status({}), activity("error", "model"));
    expect(dock.className).toContain("error");
  });

  it("shows three dots with sending text while a prompt uploads", async () => {
    const view = new ChatView();
    view.sessionId = "s";
    view.isSendingPrompt = true;
    document.body.append(view);
    await view.updateComplete;
    const host = view.renderRoot;
    expect(host.querySelectorAll(".state-dot").length).toBe(3);
    expect(host.querySelector(".activity-text")?.textContent).toContain("Sending");
  });
});
describe("backgroundWorkLabel", () => {
  // "idle" alone is a lie while this chat's children are still running: the
  // assistant's turn is over, the work is not.
  it("names the live background work that outlives the turn", () => {
    expect(backgroundWorkLabel({ rows: [], runRows: [{ status: "running" }], taskRows: [] })).toBe("idle · 1 background run");
    expect(backgroundWorkLabel({ rows: [{ status: "working" }], runRows: [{ status: "running" }], taskRows: [{ status: "running" }] }))
      .toBe("idle · 3 background runs");
  });

  it("leaves a quiet session alone", () => {
    expect(backgroundWorkLabel({ rows: [], runRows: [{ status: "done" }], taskRows: [{ status: "failed" }] })).toBeUndefined();
    expect(backgroundWorkLabel(undefined)).toBeUndefined();
  });
});
