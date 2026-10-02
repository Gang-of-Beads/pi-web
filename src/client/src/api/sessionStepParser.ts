import type { RunningTool, SessionStep } from "../../../shared/apiTypes";

/**
 * Read the step an activity frame carries (B25). A step this browser does not
 * know, from a newer daemon, or a malformed one reads as no step: the frame's
 * label still says what is happening, so the frame is kept rather than refused.
 */
export function parseSessionStep(value: unknown): SessionStep | undefined {
  const kind = field(value, "kind");
  const parse = typeof kind === "string" && Object.hasOwn(STEP_PARSERS, kind) ? STEP_PARSERS[kind] : undefined;
  return parse?.(value);
}

const STEP_PARSERS: Readonly<Record<string, (value: unknown) => SessionStep | undefined>> = {
  idle: () => ({ kind: "idle" }),
  waiting: () => ({ kind: "waiting" }),
  thinking: () => ({ kind: "thinking" }),
  writing: () => ({ kind: "writing" }),
  compacting: () => ({ kind: "compacting" }),
  preparing: (value) => {
    const tool = field(value, "tool");
    return typeof tool === "string" ? { kind: "preparing", tool } : { kind: "preparing" };
  },
  running: (value) => {
    const tools = field(value, "tools");
    if (!Array.isArray(tools)) return undefined;
    const parsed = tools.map(parseRunningTool);
    return parsed.every((tool): tool is RunningTool => tool !== undefined) ? { kind: "running", tools: parsed } : undefined;
  },
  retrying: (value) => {
    const attempt = field(value, "attempt");
    const maxAttempts = field(value, "maxAttempts");
    const reason = field(value, "reason");
    const resumesAt = field(value, "resumesAt");
    if (typeof attempt !== "number" || typeof maxAttempts !== "number" || typeof reason !== "string" || typeof resumesAt !== "string") return undefined;
    return { kind: "retrying", attempt, maxAttempts, reason, resumesAt };
  },
  bash: (value) => {
    const command = field(value, "command");
    return typeof command === "string" ? { kind: "bash", command } : undefined;
  },
};

function parseRunningTool(value: unknown): RunningTool | undefined {
  const id = field(value, "id");
  const name = field(value, "name");
  const target = field(value, "target");
  if (typeof id !== "string" || typeof name !== "string") return undefined;
  return typeof target === "string" ? { id, name, target } : { id, name };
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}
