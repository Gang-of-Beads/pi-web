/**
 * A `workflow` tool call's progress as the card shows it, read from the snapshot the
 * pi-dynamic-workflows extension puts in its tool updates' `details` (its `WorkflowSnapshot`:
 * name, phases, agents with a phase and a status, counts). The details are the extension's own
 * data and are read defensively: a value that is not a snapshot yields nothing, and the host's
 * tool card draws the row.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AgentState = "running" | "done" | "error" | "skipped" | "waiting";

export interface AgentRow {
  readonly label: string;
  readonly state: AgentState;
  /** One line under the agent: its error, or the start of its result. */
  readonly note?: string;
}

export interface PhaseGroup {
  readonly name: string;
  readonly agents: readonly AgentRow[];
  readonly done: number;
}

export interface WorkflowProgress {
  readonly name: string;
  readonly done: number;
  readonly total: number;
  readonly running: number;
  readonly failed: number;
  readonly phases: readonly PhaseGroup[];
}

const AGENT_STATES: Readonly<Record<string, AgentState>> = { running: "running", done: "done", error: "error", skipped: "skipped" };

/** The phase an agent that names none is shown under. */
const NO_PHASE = "Agents";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function agentRow(value: unknown): (AgentRow & { phase: string }) | undefined {
  if (!isRecord(value)) return undefined;
  const label = text(value["label"]);
  if (label === undefined) return undefined;
  const state = AGENT_STATES[String(value["status"])] ?? "waiting";
  const note = state === "error" ? text(value["error"]) : text(value["resultPreview"]);
  return { label, state, phase: text(value["phase"]) ?? NO_PHASE, ...(note === undefined ? {} : { note }) };
}

export function workflowProgress(details: unknown): WorkflowProgress | undefined {
  if (!isRecord(details)) return undefined;
  const name = text(details["name"]);
  const rawAgents = details["agents"];
  if (name === undefined || !Array.isArray(rawAgents)) return undefined;
  const agents = rawAgents.map(agentRow).filter((agent) => agent !== undefined);
  const declared = Array.isArray(details["phases"]) ? details["phases"].map(text).filter((phase) => phase !== undefined) : [];
  const current = text(details["currentPhase"]);
  const order = [...new Set([...declared, ...(current === undefined ? [] : [current]), ...agents.map((agent) => agent.phase)])];
  const phases = order.map((phase) => {
    const members: AgentRow[] = agents.filter((agent) => agent.phase === phase);
    return { name: phase, agents: members, done: members.filter((agent) => agent.state === "done").length };
  });
  return {
    name,
    total: agents.length,
    done: agents.filter((agent) => agent.state === "done").length,
    running: agents.filter((agent) => agent.state === "running").length,
    failed: agents.filter((agent) => agent.state === "error").length,
    phases,
  };
}
