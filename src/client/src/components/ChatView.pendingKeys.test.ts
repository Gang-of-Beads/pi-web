// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { QueuedSessionMessage, SessionStatus } from "../../../shared/apiTypes";
import type { ChatLine } from "./shared";
import { ChatView } from "./ChatView";

/**
 * A row's key is its identity for lit, for the scroll anchors, and for the
 * per-row UI state that hangs off it (expanded metadata, the copied-message
 * highlight).
 *
 * Settled rows are keyed from the window's absolute offset, `messageStart + i`.
 * Pending rows were keyed from `messages.length + i` with no offset, so the two
 * ranges overlapped as soon as the reader had loaded earlier history once:
 * anchors resolved to the wrong row, and a message moving from pending to
 * settled changed key, which makes lit discard the element instead of updating
 * it - a row that disappears and reappears rather than transitioning.
 */

function status(queued: readonly QueuedSessionMessage[]): SessionStatus {
  return {
    sessionId: "s",
    isStreaming: true,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: queued.length,
    queuedMessages: [...queued],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0,
  };
}

function userLine(text: string): ChatLine {
  return { role: "user", parts: [{ type: "text", text }] };
}

async function mount(messageStart: number, messages: readonly ChatLine[], queued: readonly QueuedSessionMessage[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  view.messageStart = messageStart;
  view.messages = [...messages];
  view.status = status(queued);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function anchorIds(view: ChatView): string[] {
  return [...view.renderRoot.querySelectorAll("[data-scroll-anchor-id]")]
    .map((element) => element.getAttribute("data-scroll-anchor-id") ?? "");
}

afterEach(() => { document.body.replaceChildren(); });

describe("pending rows share one key space with settled rows", () => {
  it("gives every rendered row a distinct anchor id after earlier history was loaded", async () => {
    const view = await mount(40, [userLine("one"), userLine("two")], [{ kind: "steer", text: "three" }]);

    const ids = anchorIds(view).filter((id) => id.startsWith("m:"));

    expect(new Set(ids).size, `duplicate anchor ids: ${ids.join(", ")}`).toBe(ids.length);
  });

  it("keys a pending row beyond the window's own offset", async () => {
    const view = await mount(40, [userLine("one"), userLine("two")], [{ kind: "steer", text: "three" }]);

    const ids = anchorIds(view).filter((id) => id.startsWith("m:"));
    const indexes = ids.map((id) => Number(id.slice(2)));

    expect(Math.min(...indexes)).toBeGreaterThanOrEqual(40);
  });

  it("keeps distinct ids when the window starts at zero", async () => {
    const view = await mount(0, [userLine("one")], [{ kind: "steer", text: "two" }]);

    const ids = anchorIds(view).filter((id) => id.startsWith("m:"));

    expect(new Set(ids).size).toBe(ids.length);
  });
});
