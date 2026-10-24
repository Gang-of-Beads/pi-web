// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { QueuedSessionMessage, SessionStatus } from "../../../shared/apiTypes";
import type { ChatLine, MessageDeliveryState } from "./shared";
import type { CommandLedgerEntry } from "../commandLedger";
import { ChatView } from "./ChatView";

afterEach(() => {
  document.body.replaceChildren();
});

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

const sent = (text: string, clientMessageId: string, state: MessageDeliveryState, timestamp: string): ChatLine => ({
  role: "user",
  parts: [{ type: "text", text }],
  meta: { timestamp, delivery: { clientMessageId, state } },
});
const settled = (role: ChatLine["role"], text: string): ChatLine => ({ role, parts: [{ type: "text", text }] });

async function drawnTexts(messages: ChatLine[], queued: readonly QueuedSessionMessage[], commandLedger: CommandLedgerEntry[] = []): Promise<string[]> {
  const view = new ChatView();
  view.sessionId = "s";
  view.messages = messages;
  view.status = status(queued);
  view.commandLedger = commandLedger;
  document.body.append(view);
  await view.updateComplete;
  return [...(view.shadowRoot?.querySelectorAll("article.msg") ?? [])].map((row) => {
    const text: unknown = Reflect.get(row.querySelector("formatted-text") ?? {}, "text");
    return typeof text === "string" ? text : row.querySelector(".command-text")?.textContent ?? "";
  }).filter((text) => text !== "");
}

/**
 * An earlier message was drawn below a later one (B2, state-diagram D1 "Row placement is a
 * function of state"): a message the daemon still lists as queued left its transcript slot for the
 * pending block below every settled row, while a later one still being sent kept its slot above it.
 */
describe("a waiting message is placed by its state, never by where its line happens to sit", () => {
  /**
   * The order the agent takes them (owner, 2026-10-23, "Order"): another device's message queued
   * earlier goes first, and this browser's own messages keep their send order whichever of them the
   * machine has confirmed. One the queue no longer lists though a later one of this browser waits
   * there was taken by the agent: it heads the block instead of trailing the one sent after it.
   */
  it("keeps a queued message above a later one that is still being sent, and an earlier one the agent took above both", async () => {
    const texts = await drawnTexts([
      settled("assistant", "working on it"),
      sent("taken", "t", "received", "2026-10-02T10:00:00.000Z"),
      sent("first", "a", "queued", "2026-10-02T10:00:01.000Z"),
      sent("second", "b", "sending", "2026-10-02T10:00:02.000Z"),
    ], [{ kind: "steer", text: "from another device", clientMessageId: "x" }, { kind: "steer", text: "first", clientMessageId: "a" }]);

    expect(texts).toEqual(["working on it", "taken", "from another device", "first", "second"]);
  });

  it("draws a line the daemon still lists as waiting below the settled ones though the line itself says nothing of delivery (an echo)", async () => {
    const echo: ChatLine = { role: "user", parts: [{ type: "text", text: "echoed" }], meta: { echo: true, echoClientMessageId: "e" } };
    const texts = await drawnTexts([settled("assistant", "a reply"), echo, settled("assistant", "a later reply")], [{ kind: "steer", text: "echoed", clientMessageId: "e" }]);
    const stillWritten = [...(document.querySelector("chat-view")?.shadowRoot?.querySelectorAll("article.msg formatted-text") ?? [])].map((part): unknown => Reflect.get(part, "streaming"));

    expect(texts).toEqual(["a reply", "a later reply", "echoed"]);
    expect(stillWritten).toEqual([false, true, false]);

    const view = document.querySelector("chat-view");
    if (!(view instanceof ChatView)) throw new Error("no chat view");
    view.hasNewer = true;
    await view.updateComplete;
    const withNewerUnloaded = [...(view.shadowRoot?.querySelectorAll("article.msg formatted-text") ?? [])].map((part): unknown => Reflect.get(part, "streaming"));

    expect(withNewerUnloaded).toEqual([false, false, false]);

    view.hasNewer = false;
    await view.updateComplete;
    view.messages = [...view.messages, { role: "tool", parts: [{ type: "toolExecution", toolName: "bash", summary: "sleep 150", status: "running" }] }];
    await view.updateComplete;
    const afterToolStarts = [...(view.shadowRoot?.querySelectorAll("article.msg formatted-text") ?? [])].map((part): unknown => Reflect.get(part, "streaming"));

    expect(afterToolStarts).toEqual([false, false, false]);
  });
});
