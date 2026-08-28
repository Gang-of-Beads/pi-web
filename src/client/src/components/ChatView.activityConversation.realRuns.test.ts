import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { subagentRunConversationView } from "../appState";
import { branchMessages } from "../../../server/sessions/branchMessages";
import { runTranscriptMessages } from "../../../server/sessions/subagentRunTranscript";

/**
 * The reading path end to end, over transcripts copied from real runs.
 *
 * A hand-written fixture already hid a wrong premise in this feature once: it
 * satisfied the transcript locator while never exercising the projection, so
 * fork-context children looked supported when they projected to nothing. These
 * fixtures are real files, and the assertions are about what a reader ends up
 * seeing rather than about the shape of an intermediate.
 */
const FIXTURES = join(__dirname, "../../../../test-fixtures/subagent-run-transcript");

function entriesOf(name: string): unknown[] {
  return readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line): unknown => JSON.parse(line));
}

const RUN = { runId: "139dd2a2-36b9-4bd1-8c95-ae2c13829a12", agent: "worker", status: "running" };

describe("a child run's conversation, from real transcripts", () => {
  it("turns a fork-context event log into turns a reader can follow", () => {
    const entries = entriesOf("fork-context.jsonl");

    const projected = runTranscriptMessages(entries, branchMessages);
    const view = subagentRunConversationView(RUN, { messages: projected, total: projected.length });

    expect(view.empty).toBe(false);
    expect(view.messages.length).toBeGreaterThan(0);
    // The words the child actually said have to survive the whole path, and a
    // tool call has to arrive as a tool call rather than as prose about one.
    const text = view.messages.flatMap((line) => line.parts).map((part) => JSON.stringify(part)).join(" ");
    expect(text).toContain("I'll start by mapping the SDK surface");
    expect(view.messages.some((line) => line.parts.some((part) => part.type === "toolExecution"))).toBe(true);
  });

  it("turns a fresh-context session file into the same kind of turns", () => {
    const entries = entriesOf("fresh-context.jsonl");

    const projected = runTranscriptMessages(entries, branchMessages);
    const view = subagentRunConversationView(RUN, { messages: projected, total: projected.length });

    expect(view.empty).toBe(false);
    expect(view.messages.length).toBeGreaterThan(0);
    expect(view.messages.some((line) => line.role === "assistant")).toBe(true);
  });

  /**
   * Both child kinds reach the renderer as the same thing. If they did not,
   * one of them would need a second view - which is the outcome this design
   * exists to avoid.
   */
  it("yields one shape whichever kind of child was started", () => {
    const fork = subagentRunConversationView(RUN, (() => {
      const messages = runTranscriptMessages(entriesOf("fork-context.jsonl"), branchMessages);
      return { messages, total: messages.length };
    })());
    const fresh = subagentRunConversationView(RUN, (() => {
      const messages = runTranscriptMessages(entriesOf("fresh-context.jsonl"), branchMessages);
      return { messages, total: messages.length };
    })());

    for (const line of [...fork.messages, ...fresh.messages]) {
      expect(typeof line.role).toBe("string");
      expect(Array.isArray(line.parts)).toBe(true);
    }
  });
});
