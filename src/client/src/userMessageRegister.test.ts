import { describe, expect, it } from "vitest";
import { registerUserMessages } from "./userMessageRegister.js";
import type { ChatLine } from "./components/shared.js";
import type { QueuedSessionMessage } from "./api.js";

/**
 * The property every one of the ten previous fixes was trying to hold by hand:
 * N distinct messages produce N rows, whatever combination of sources is
 * describing them.
 *
 * Each of those fixes improved the rule for deciding whether two rows were the
 * same message. This asserts the outcome instead, so a future change that
 * reintroduces a second row fails here rather than on somebody's phone.
 */

function bubble(clientMessageId: string, text: string): ChatLine {
  return {
    role: "user",
    parts: text === "" ? [] : [{ type: "text", text }],
    meta: { delivery: { clientMessageId, state: "sending" as const, kind: "followUp" as const } },
  };
}

function settled(clientMessageId: string | undefined, text: string): ChatLine {
  return {
    role: "user",
    parts: [{ type: "text", text }],
    ...(clientMessageId === undefined ? {} : { meta: { delivery: { clientMessageId, state: "delivered" as const, kind: "followUp" as const } } }),
  };
}

function queuedEntry(text: string, clientMessageId?: string, kind: "steer" | "followUp" = "followUp"): QueuedSessionMessage {
  return { kind, text, ...(clientMessageId === undefined ? {} : { clientMessageId }) };
}

function register(input: { transcript?: ChatLine[]; optimistic?: ChatLine[]; queued?: QueuedSessionMessage[] }) {
  return registerUserMessages({
    transcript: input.transcript ?? [],
    optimistic: input.optimistic ?? [],
    queued: input.queued ?? [],
    synthesise: (message) => settled(message.clientMessageId, message.text),
  });
}

describe("one message, one row", () => {
  it("draws one row when the bubble and the queue describe the same message", () => {
    expect(register({ optimistic: [bubble("c1", "hello")], queued: [queuedEntry("hello", "c1")] })).toHaveLength(1);
  });

  /** The runtime rewrites slash commands, so the texts differ for one message. */
  it("draws one row when the queue reports different text for the same id", () => {
    expect(register({ optimistic: [bubble("c1", "/skill foo")], queued: [queuedEntry("expanded skill body", "c1")] })).toHaveLength(1);
  });

  /** An attachment-only message has no words on either side. */
  it("draws one row for a message with no text at all", () => {
    expect(register({ optimistic: [bubble("c1", "")], queued: [queuedEntry("", "c1")] })).toHaveLength(1);
  });

  /** The lane swap: two lanes, ids that a positional rule would exchange. */
  it("draws two rows for two messages across two lanes", () => {
    const rows = register({
      optimistic: [bubble("c-follow", "a"), bubble("c-steer", "b")],
      queued: [queuedEntry("b", "c-steer", "steer"), queuedEntry("a", "c-follow")],
    });

    expect(rows).toHaveLength(2);
  });

  /**
   * The queue is the authority on what is still waiting. A line already in the
   * transcript that the daemon still reports as queued has not been delivered,
   * and drawing it as settled is what put one message in two places at once.
   */
  it("keeps a message the queue still reports as waiting", () => {
    const rows = register({ transcript: [settled("c1", "hello")], queued: [queuedEntry("hello", "c1")] });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("queued");
  });

  it("draws one settled row once the queue no longer holds it", () => {
    const rows = register({ transcript: [settled("c1", "hello")] });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.state).toBe("settled");
  });

  /** Two genuinely identical messages are two messages. */
  it("keeps two rows for the same words sent twice", () => {
    expect(register({ optimistic: [bubble("c1", "again"), bubble("c2", "again")] })).toHaveLength(2);
  });

  /** A message from elsewhere has no minted id and must not collide. */
  it("keeps messages this browser did not send apart", () => {
    expect(register({ transcript: [settled(undefined, "from cli"), settled(undefined, "from cli")] })).toHaveLength(2);
  });

  it("does not let an idless queue entry take over somebody else's row", () => {
    const rows = register({ optimistic: [bubble("c1", "mine")], queued: [queuedEntry("mine")] });

    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.identity === "c1")).toHaveLength(1);
  });

  /**
   * The property itself, over a mixed population: every identity appears once,
   * however many sources described it.
   */
  it("produces exactly one row per identity across all sources", () => {
    const rows = register({
      transcript: [settled("c1", "one")],
      optimistic: [bubble("c1", "one"), bubble("c2", "two"), bubble("c3", "")],
      queued: [queuedEntry("two expanded", "c2"), queuedEntry("", "c3"), queuedEntry("one", "c1")],
    });

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.identity)).size).toBe(3);
  });
});
