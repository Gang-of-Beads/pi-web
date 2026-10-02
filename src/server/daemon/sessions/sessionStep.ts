import type { RunningTool, SessionStep } from "../../../shared/apiTypes.js";

/**
 * What a session's agent is doing, from pi's event pairs (B25 and B15,
 * state-diagram D3 "The status line narrates").
 *
 * The daemon used to turn each event into its own word ("message started",
 * "receiving response", "turn complete", "tool failed") and publish an idle
 * phase at every message and tool end, so the dock flickered between running
 * and idle inside one turn and kept the last word ("message queued") long
 * after its moment. Each state here ends only when its pair closes, and one
 * `agent_end` is the run's only way to idle.
 */
export const IDLE_STEP: SessionStep = { kind: "idle" };

/** What the reducer needs beside the event. */
export interface StepFacts {
  now: number;
  /** Whether a run is going, for the end of compaction or of the reader's shell command. */
  running: boolean;
  /** One line for what a tool was called with. */
  describeArgs(args: unknown): string;
}

type StepHandler = (step: SessionStep, event: unknown, facts: StepFacts) => SessionStep;

const WAITING: SessionStep = { kind: "waiting" };
const THINKING: SessionStep = { kind: "thinking" };
const WRITING: SessionStep = { kind: "writing" };
const COMPACTING: SessionStep = { kind: "compacting" };

const STREAM_STEPS: Readonly<Record<string, StepHandler>> = {
  thinking_start: () => THINKING,
  thinking_delta: () => THINKING,
  text_start: () => WRITING,
  text_delta: () => WRITING,
  toolcall_start: (_step, event) => preparing(event),
  toolcall_delta: (_step, event) => preparing(event),
};

const EVENT_STEPS: Readonly<Record<string, StepHandler>> = {
  agent_start: () => WAITING,
  turn_start: () => WAITING,
  turn_end: () => WAITING,
  agent_end: () => IDLE_STEP,
  message_update: (step, event, facts) => {
    const streamed = stringField(Reflect.get(Object(event), "assistantMessageEvent"), "type");
    const handler = streamed === undefined ? undefined : STREAM_STEPS[streamed];
    return handler === undefined ? step : handler(step, event, facts);
  },
  tool_execution_start: (step, event, facts) => startTool(step, event, facts),
  tool_execution_end: (step, event) => endTool(step, event),
  auto_retry_start: (_step, event, facts) => retrying(event, facts),
  auto_retry_end: () => WAITING,
  compaction_start: () => COMPACTING,
  compaction_end: (_step, _event, facts) => (facts.running ? WAITING : IDLE_STEP),
  bash_execution_start: (_step, event) => ({ kind: "bash", command: stringField(event, "command") ?? "" }),
  bash_execution_end: (_step, _event, facts) => (facts.running ? WAITING : IDLE_STEP),
};

/**
 * The step after `event`. Returns `step` itself when the event changes
 * nothing, so a caller can skip publishing by identity.
 */
export function nextSessionStep(step: SessionStep, event: unknown, facts: StepFacts): SessionStep {
  const type = stringField(event, "type");
  const handler = type === undefined ? undefined : EVENT_STEPS[type];
  if (handler === undefined) return step;
  const next = handler(step, event, facts);
  return sameStep(step, next) ? step : next;
}

/** The words an older reader shows for a step, as label and detail. */
export function stepWords(step: SessionStep): { label: string; detail?: string } {
  return STEP_WORDS[step.kind](step);
}

/** The phase an older reader colours by: a step is work until the run's one idle. */
export function stepPhase(step: SessionStep): "active" | "idle" {
  return step.kind === "idle" ? "idle" : "active";
}

const STEP_WORDS: Readonly<Record<SessionStep["kind"], (step: SessionStep) => { label: string; detail?: string }>> = {
  idle: () => ({ label: "idle" }),
  waiting: () => ({ label: "waiting for the model" }),
  thinking: () => ({ label: "thinking" }),
  writing: () => ({ label: "writing the reply" }),
  preparing: (step) => withDetail("preparing a tool call", step.kind === "preparing" ? step.tool : undefined),
  running: (step) => withDetail("running tool", step.kind === "running" ? step.tools.map(toolLine).join(" · ") : undefined),
  retrying: (step) => withDetail("retrying", step.kind === "retrying" ? `attempt ${String(step.attempt)} of ${String(step.maxAttempts)}: ${step.reason}` : undefined),
  compacting: () => ({ label: "compacting" }),
  bash: (step) => withDetail("running bash", step.kind === "bash" ? step.command : undefined),
};

function withDetail(label: string, detail: string | undefined): { label: string; detail?: string } {
  return detail === undefined || detail === "" ? { label } : { label, detail };
}

function toolLine(tool: RunningTool): string {
  return tool.target === undefined || tool.target === "" ? tool.name : `${tool.name}: ${tool.target}`;
}

function preparing(event: unknown): SessionStep {
  const streamed: unknown = Reflect.get(Object(event), "assistantMessageEvent");
  const index = numberField(streamed, "contentIndex");
  const content: unknown = Reflect.get(Object(Reflect.get(Object(streamed), "partial")), "content");
  const block: unknown = Array.isArray(content) && index !== undefined ? content[index] : undefined;
  const tool = stringField(block, "name");
  return tool === undefined || tool === "" ? { kind: "preparing" } : { kind: "preparing", tool };
}

function startTool(step: SessionStep, event: unknown, facts: StepFacts): SessionStep {
  const name = stringField(event, "toolName") ?? "tool";
  const target = facts.describeArgs(Reflect.get(Object(event), "args"));
  const tool: RunningTool = { id: stringField(event, "toolCallId") ?? name, name, ...(target === "" ? {} : { target }) };
  const others = step.kind === "running" ? step.tools.filter((running) => running.id !== tool.id) : [];
  return { kind: "running", tools: [...others, tool] };
}

function endTool(step: SessionStep, event: unknown): SessionStep {
  if (step.kind !== "running") return step;
  const id = stringField(event, "toolCallId") ?? stringField(event, "toolName");
  const tools = step.tools.filter((running) => running.id !== id);
  return tools.length === 0 ? WAITING : { kind: "running", tools };
}

function retrying(event: unknown, facts: StepFacts): SessionStep {
  const attempt = numberField(event, "attempt") ?? 1;
  const delayMs = numberField(event, "delayMs") ?? 0;
  return {
    kind: "retrying",
    attempt,
    maxAttempts: numberField(event, "maxAttempts") ?? attempt,
    reason: stringField(event, "errorMessage") ?? "",
    resumesAt: new Date(facts.now + delayMs).toISOString(),
  };
}

function sameStep(left: SessionStep, right: SessionStep): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function stringField(value: unknown, key: string): string | undefined {
  const field: unknown = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  return typeof field === "string" ? field : undefined;
}

function numberField(value: unknown, key: string): number | undefined {
  const field: unknown = typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
  return typeof field === "number" && Number.isFinite(field) ? field : undefined;
}
