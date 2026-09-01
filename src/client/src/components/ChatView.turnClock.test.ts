// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionStatus } from "../../../shared/apiTypes";
import { ChatView } from "./ChatView";

function workingStatus(over: Partial<SessionStatus> = {}): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    queuedMessages: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
    ...over,
  };
}

async function mountWith(status: SessionStatus): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  view.status = status;
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function anchorOf(view: ChatView): number | undefined {
  const value: unknown = Reflect.get(view, "turnStartedAtMs");
  return typeof value === "number" ? value : undefined;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/**
 * The clock used to start when this tab first rendered a working session, so
 * a viewer who joined mid-turn - a reload, a reconnect, switching back to the
 * session - saw a turn that had been running for minutes read as freshly
 * started, and could not tell a slow turn from a stuck one.
 */
describe("the turn clock's anchor", () => {
  it("clocks from the daemon's recorded turn start when the status carries one", async () => {
    const startedAt = "2026-02-03T10:00:00.000Z";
    const view = await mountWith(workingStatus({ turnStartedAt: startedAt }));

    expect(anchorOf(view)).toBe(Date.parse(startedAt));
  });

  it("re-anchors when a later status reports a new turn start", async () => {
    const view = await mountWith(workingStatus({ turnStartedAt: "2026-02-03T10:00:00.000Z" }));
    view.status = workingStatus({ turnStartedAt: "2026-02-03T11:00:00.000Z" });
    await view.updateComplete;

    expect(anchorOf(view)).toBe(Date.parse("2026-02-03T11:00:00.000Z"));
  });

  /** A daemon that does not publish the field keeps the previous behaviour. */
  it("falls back to first sighting without the field", async () => {
    const before = Date.now();
    const view = await mountWith(workingStatus());
    const anchor = anchorOf(view);

    expect(anchor).toBeDefined();
    expect(anchor ?? 0).toBeGreaterThanOrEqual(before);
  });

  it("drops the anchor when the session goes quiet", async () => {
    const view = await mountWith(workingStatus({ turnStartedAt: "2026-02-03T10:00:00.000Z" }));
    view.status = workingStatus({ isStreaming: false });
    await view.updateComplete;

    expect(anchorOf(view)).toBeUndefined();
  });
});
