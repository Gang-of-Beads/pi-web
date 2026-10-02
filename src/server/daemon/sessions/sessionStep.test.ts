import { describe, expect, it } from "vitest";
import type { SessionStep } from "../../../shared/apiTypes.js";
import { IDLE_STEP, nextSessionStep, stepPhase, stepWords, type StepFacts } from "./sessionStep.js";

const facts = (running = true): StepFacts => ({ now: Date.parse("2026-10-02T10:00:00.000Z"), running, describeArgs: (args) => String(Reflect.get(Object(args), "command") ?? "") });
const streamed = (type: string, partial: unknown = { content: [] }, contentIndex = 0) => ({ type: "message_update", assistantMessageEvent: { type, contentIndex, partial } });
const run = (events: unknown[], from: SessionStep = IDLE_STEP, running = true): SessionStep => events.reduce<SessionStep>((step, event) => nextSessionStep(step, event, facts(running)), from);

describe("the step a session's agent is in (B25, B15)", () => {
  it("follows one turn: waiting, thinking, writing, preparing a tool, running it, waiting, idle once", () => {
    const steps = [
      { type: "agent_start" },
      { type: "turn_start" },
      streamed("thinking_delta"),
      streamed("text_delta"),
      streamed("toolcall_start", { content: [{ type: "text" }, { type: "toolCall", name: "bash" }] }, 1),
      { type: "message_end" },
      { type: "tool_execution_start", toolCallId: "c1", toolName: "bash", args: { command: "sleep 25" } },
      { type: "tool_execution_end", toolCallId: "c1", toolName: "bash" },
      { type: "turn_end" },
      { type: "agent_end" },
    ].reduce<SessionStep[]>((seen, event) => [...seen, nextSessionStep(seen.at(-1) ?? IDLE_STEP, event, facts())], []);

    expect(steps.map((step) => step.kind)).toEqual(["waiting", "waiting", "thinking", "writing", "preparing", "preparing", "running", "waiting", "waiting", "idle"]);
    expect(steps[4]).toEqual({ kind: "preparing", tool: "bash" });
    expect(steps[6]).toEqual({ kind: "running", tools: [{ id: "c1", name: "bash", target: "sleep 25" }] });
  });

  it("never reaches idle inside a run: message and tool ends and turn ends keep it working (B15)", () => {
    const inside = [{ type: "message_end" }, { type: "tool_execution_end", toolCallId: "c9" }, { type: "turn_end" }, { type: "message_start" }];

    expect(inside.map((event) => stepPhase(nextSessionStep({ kind: "writing" }, event, facts())))).toEqual(["active", "active", "active", "active"]);
  });

  it("keeps tools running in parallel until the last one ends", () => {
    const started = run([
      { type: "tool_execution_start", toolCallId: "a", toolName: "ask_user", args: {} },
      { type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "sleep 25" } },
    ], { kind: "preparing" });
    expect(started).toEqual({ kind: "running", tools: [{ id: "a", name: "ask_user" }, { id: "b", name: "bash", target: "sleep 25" }] });
    const both = run([
      { type: "tool_execution_start", toolCallId: "a", toolName: "ask_user", args: {} },
      { type: "tool_execution_start", toolCallId: "b", toolName: "bash", args: { command: "sleep 25" } },
      { type: "tool_execution_end", toolCallId: "a", toolName: "ask_user" },
    ], { kind: "preparing" });

    expect(both).toEqual({ kind: "running", tools: [{ id: "b", name: "bash", target: "sleep 25" }] });
    expect(run([{ type: "tool_execution_end", toolCallId: "b" }], both)).toEqual({ kind: "waiting" });
  });

  it("says a retry with its attempt, its reason and when it resumes", () => {
    expect(run([{ type: "auto_retry_start", attempt: 2, maxAttempts: 3, delayMs: 4000, errorMessage: "overloaded" }], { kind: "waiting" }))
      .toEqual({ kind: "retrying", attempt: 2, maxAttempts: 3, reason: "overloaded", resumesAt: "2026-10-02T10:00:04.000Z" });
  });

  it("ends compaction and the reader's shell command in waiting during a run and idle outside one", () => {
    expect({
      compactingInRun: run([{ type: "compaction_start" }, { type: "compaction_end" }], { kind: "waiting" }).kind,
      compactingAlone: run([{ type: "compaction_start" }, { type: "compaction_end" }], IDLE_STEP, false).kind,
      bashAlone: run([{ type: "bash_execution_start", command: "ls" }, { type: "bash_execution_end" }], IDLE_STEP, false).kind,
    }).toEqual({ compactingInRun: "waiting", compactingAlone: "idle", bashAlone: "idle" });
  });

  it("leaves the step alone for events it does not know, by identity", () => {
    const writing: SessionStep = { kind: "writing" };

    expect([{ type: "queue_update" }, { type: "entry_appended" }, streamed("text_delta"), {}].map((event) => nextSessionStep(writing, event, facts()) === writing)).toEqual([true, true, true, true]);
  });

  it("derives the words older readers show from the step", () => {
    expect([
      stepWords(IDLE_STEP),
      stepWords({ kind: "running", tools: [{ id: "b", name: "bash", target: "sleep 25" }, { id: "r", name: "read" }] }),
      stepWords({ kind: "retrying", attempt: 2, maxAttempts: 3, reason: "overloaded", resumesAt: "t" }),
      stepWords({ kind: "preparing" }),
    ]).toEqual([
      { label: "idle" },
      { label: "running tool", detail: "bash: sleep 25 · read" },
      { label: "retrying", detail: "attempt 2 of 3: overloaded" },
      { label: "preparing a tool call" },
    ]);
  });
});
