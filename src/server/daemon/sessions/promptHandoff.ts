/**
 * When the daemon's inbox hands waiting prompts to the runtime, and how.
 *
 * The owner's rule (docs/design/state-sync-redesign.md, 2026-09-29): while the agent runs,
 * every message is a steer. pi-web holds them - visible, recallable - and at the next gap
 * hands everything waiting to pi together, in the order the daemon accepted them. When the
 * agent is idle, the oldest waiting message starts the next run.
 *
 * The decision used to be made at request time from `isStreaming`, which the SDK sets only
 * after the prompt preflight awaits. A message accepted in that window read as "idle", was
 * handed as a second direct prompt and refused, and a later steer overtook a message parked
 * minutes earlier (session 01a04701, 2026-09-28). Here the inbox is the only path to the
 * runtime, and the decision is a pure function of what the runtime is doing.
 */

/**
 * `settling`: the SDK has cleared its run flag but pi-web has not yet seen `agent_settled`.
 * The SDK clears the flag before it awaits extension `agent_settled` handlers, and a prompt
 * handed in that window is deferred by the SDK - invisible, unrecallable, and run after
 * whatever is steered meanwhile. Nothing is handed until the run has visibly settled.
 */
export type RunState = "compacting" | "handing" | "running" | "settling" | "idle";

/**
 * `gap`: a point where pi polls its steering queue (a tool finished, a turn ended, compaction
 * ended). `settled`: the run is over. `nudge`: anything else worth re-deciding on - an
 * acceptance, a handoff, a heartbeat, a restored queue.
 */
export type HandoffTrigger = "gap" | "settled" | "nudge";

export type Handoff =
  | { kind: "wait" }
  | { kind: "direct" }
  | { kind: "steer"; count: number };

export interface HandoffFacts {
  waiting: number;
  run: RunState;
  trigger: HandoffTrigger;
}

export function runStateOf(facts: { isCompacting: boolean; isStreaming: boolean; handing: boolean; settling: boolean }): RunState {
  if (facts.isCompacting) return "compacting";
  if (facts.handing) return "handing";
  if (facts.isStreaming) return "running";
  return facts.settling ? "settling" : "idle";
}

/** The only run state each kind of handoff may enter: a steer joins a running agent, a direct prompt starts an idle one. */
export const HANDOFF_RUN_STATE: Readonly<Record<"steer" | "direct", RunState>> = {
  steer: "running",
  direct: "idle",
};

/** How long a run may look finished without its `agent_settled` before the inbox stops waiting. */
export const SETTLE_GRACE_MS = 5_000;

/** Whether a run the SDK has stopped streaming still counts as settling. */
export function isSettling(run: { quietSince?: number | undefined } | undefined, now: number): boolean {
  if (run === undefined) return false;
  return run.quietSince === undefined || now - run.quietSince < SETTLE_GRACE_MS;
}

const WAIT: Handoff = { kind: "wait" };

const BY_RUN_STATE: Record<RunState, (facts: HandoffFacts) => Handoff> = {
  compacting: () => WAIT,
  handing: () => WAIT,
  settling: () => WAIT,
  running: (facts) => facts.trigger === "gap" ? { kind: "steer", count: facts.waiting } : WAIT,
  idle: () => ({ kind: "direct" }),
};

/**
 * How many waiting messages the idle injection point hands together (D1, B33): everything up to
 * the first extension command. A command is its own handoff, because pi runs it before it
 * considers queueing and `steer` refuses one; so a command at the head goes alone.
 */
export function idleBatchSize(isCommand: readonly boolean[]): number {
  const firstCommand = isCommand.indexOf(true);
  if (firstCommand === 0) return 1;
  return firstCommand === -1 ? isCommand.length : firstCommand;
}

export function nextHandoff(facts: HandoffFacts): Handoff {
  if (facts.waiting === 0) return WAIT;
  return BY_RUN_STATE[facts.run](facts);
}

export const HANDOFF_TRIGGER_BY_EVENT: Readonly<Record<string, HandoffTrigger>> = {
  tool_execution_end: "gap",
  turn_end: "gap",
  agent_end: "gap",
  compaction_end: "gap",
  agent_settled: "settled",
};

/**
 * `transient`: the runtime is momentarily busy - the entry keeps its place at the head and is
 * offered again at the next fact. `terminal`: the runtime will not take it (no model, no
 * credentials, a rejected input) - retrying cannot help, so it is reported and released.
 */
export type RefusalKind = "transient" | "terminal";

export type HandoffVerdict = "handed" | RefusalKind;

const TRANSIENT_REFUSALS: readonly RegExp[] = [
  /already processing/i,
  /compaction is in progress/i,
  /session tree navigation is active/i,
];

export function refusalKind(message: string): RefusalKind {
  return TRANSIENT_REFUSALS.some((pattern) => pattern.test(message)) ? "transient" : "terminal";
}
