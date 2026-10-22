/**
 * When the daemon's inbox hands waiting prompts to the runtime, and how.
 *
 * The owner's rule (docs/design/state-sync-redesign.md, 2026-09-29; D1 in state-diagram.md):
 * while the agent runs, every message is a steer, and everything waiting reaches the model in one
 * request at the next injection point. pi's own steering lane is that injection point: pi drains
 * all of it at its next poll. So a message accepted while the agent runs is handed to the lane at
 * once, in acceptance order, and waits there - listed, recallable, and kept in the inbox file's
 * handed list until pi reads it (B33). Holding it until a gap instead could not batch: the daemon
 * hears of a gap only after pi polled at it, and a held batch handed one entry at a time straddled
 * pi's last check (measured: A; then B and C; then D alone). When the agent is idle, the waiting
 * messages up to the first extension command start the next run together; a command at the head
 * goes alone.
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
 *
 * `stopping`: the run still streams after the reader's Stop cut it. A steer handed now would be
 * read by a reply that never answers it, so a message accepted meanwhile waits and starts the
 * next run once the stop has completed (owner, 2026-10-22). An extension command at the head of
 * the inbox still runs at once, as pi runs one while a reply streams (docs/faq.md); one accepted
 * behind a held message keeps its place and runs once that message has started its run.
 */
export type RunState = "compacting" | "handing" | "stopping" | "running" | "settling" | "idle";

export type Handoff =
  | { kind: "wait" }
  | { kind: "direct" }
  | { kind: "steer"; count: number };

export interface HandoffFacts {
  waiting: number;
  /** How many of the waiting entries, from the head, are extension commands. */
  leadingCommands: number;
  run: RunState;
}

export function runStateOf(facts: { isCompacting: boolean; isStreaming: boolean; handing: boolean; cutByReader: boolean; settling: boolean }): RunState {
  if (facts.isCompacting) return "compacting";
  if (facts.handing) return "handing";
  if (facts.isStreaming) return facts.cutByReader ? "stopping" : "running";
  return facts.settling ? "settling" : "idle";
}

/** The run state each kind of handoff enters outside a stop: a steer joins a running agent, a direct prompt starts an idle one; `handoffEnters` adds the commands a stopping run still takes. */
const HANDOFF_RUN_STATE: Readonly<Record<"steer" | "direct", RunState>> = {
  steer: "running",
  direct: "idle",
};

/** Whether a handoff may enter the run state it finds; an extension command steered while a stopped run ends runs at once. */
export function handoffEnters(run: RunState, handoff: "steer" | "direct", isCommand: boolean): boolean {
  if (run === "stopping") return handoff === "steer" && isCommand;
  return run === HANDOFF_RUN_STATE[handoff];
}

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
  stopping: (facts) => (facts.leadingCommands === 0 ? WAIT : { kind: "steer", count: facts.leadingCommands }),
  settling: () => WAIT,
  running: (facts) => ({ kind: "steer", count: facts.waiting }),
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

/** How many waiting entries, from the head, are extension commands. */
export function leadingCommandCount(isCommand: readonly boolean[]): number {
  const firstMessage = isCommand.indexOf(false);
  return firstMessage === -1 ? isCommand.length : firstMessage;
}

export function nextHandoff(facts: HandoffFacts): Handoff {
  if (facts.waiting === 0) return WAIT;
  return BY_RUN_STATE[facts.run](facts);
}

/**
 * The runtime events after which the decision may have changed: the run state moved (a compaction
 * ended, the run settled) or pi reached a point where it reads its lane. The decision itself reads
 * only the run state; why the inbox was woken does not enter it (B33).
 */
export const HANDOFF_WAKE_EVENTS: ReadonlySet<string> = new Set(["tool_execution_end", "turn_end", "agent_end", "compaction_end", "agent_settled"]);

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
