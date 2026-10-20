/**
 * The browser's own record of the commands it has issued.
 *
 * This mirrors pi's own TUI: a built-in slash command is not a message and
 * writes no transcript entry (the model never sees it); the result is shown
 * inline where the command was issued and stays there for the life of the
 * page. A runtime command is forwarded to the agent and streams back as its
 * own expanded message, so its row is only the receipt of the forwarding.
 * The daemon runs it behind whatever turn is in flight, and until it
 * answers, a row is the only evidence the press happened - the owner once
 * pressed goal Resume four times against a command accepted every time.
 *
 * The ledger is a client-side projection, not server truth: rows are scoped
 * to the session key they were issued under - a row must never render
 * beneath another session's transcript - and read with the same delivery
 * vocabulary as a sent message, so one bubble grammar covers both.
 */

import type { CommandMessageFormat, CommandResult, FoldedMarkdown } from "../../shared/apiTypes";

/**
 * `accepted` is a command the daemon took but has not run: a runtime command
 * forwarded as a prompt behind the reply in flight, or one parked until its
 * session starts. It reads as Queued, never as Read - acceptance dressed as
 * completion is what the archived action-acknowledgment spec forbids.
 * `running` is an extension command the daemon took: pi runs its handler at
 * once, even while a reply streams, so it is not queued behind anything; it
 * reads as Running until the session says the handler returned.
 */
export type CommandLedgerState = "pending" | "accepted" | "running" | "ok" | "failed";

/**
 * What a command's own result means for its receipt.
 *
 * The receipt used to be settled by whether the request threw, which is a
 * statement about the network, not about the command. A refusal travels as a
 * perfectly successful response, so "/share done" was displayed beside the
 * server's own "/share is not implemented in the web UI yet" - two receipts for
 * one action, disagreeing, and a reader believes the green one.
 *
 * Undefined means the command has not settled: a select or tree result opens a
 * dialog and the command is still waiting on the reader. A deferred result is
 * accepted, not done - the daemon says so explicitly so the browser never has
 * to guess from prose or from whichever session's status it happens to hold.
 * An extension command's result settles later, when its handler returns
 * (`command.settled`): until then it is running, with no line under it.
 */
export function commandOutcomeFor(result: CommandResult): CommandOutcome | undefined {
  if (result.type === "select" || result.type === "tree") return undefined;
  if (result.type === "unsupported") return { state: "failed", resultText: result.message };
  if (result.settlesLater === true) return { state: "running" };
  const resultText = result.message === undefined || result.message === "" ? undefined : result.message;
  if (result.deferred === true) return { state: "accepted", resultText: resultText ?? "Runs after the current reply finishes." };
  if (resultText === undefined && result.folded === undefined) return { state: "ok" };
  return {
    state: "ok",
    ...(resultText === undefined ? {} : { resultText }),
    ...(result.format === undefined ? {} : { resultFormat: result.format }),
    ...(result.folded === undefined ? {} : { resultFolded: result.folded }),
  };
}

/** How a command settled: its row's state, and the line beneath it with the format the daemon wrote it in. */
export interface CommandOutcome {
  state: "accepted" | "running" | "ok" | "failed";
  resultText?: string;
  resultFormat?: CommandMessageFormat;
  /** The markdown result as folded sections (`/changelog`), when the daemon sent them. */
  resultFolded?: FoldedMarkdown;
}

export interface CommandLedgerEntry {
  readonly id: string;
  /** machine+session identity the command was issued under. */
  readonly sessionKey: string;
  readonly text: string;
  readonly state: CommandLedgerState;
  readonly issuedAt: number;
  /** The key of the last row the page held when the command was issued, which the row is drawn after (D1, #226). */
  readonly afterRowKey?: string;
  /** Failure text, or a one-line result when the command produced one. */
  readonly resultText?: string;
  /** `markdown` when the result is markdown (`/changelog`); plain text otherwise. */
  readonly resultFormat?: CommandMessageFormat;
  /** The markdown result as folded sections, each drawn closed under its heading (`/changelog`). */
  readonly resultFolded?: FoldedMarkdown;
  readonly settledAt?: number;
}

/** Most rows one session keeps; older finished rows drop first. */
const LEDGER_CAP = 20;

let nextLedgerId = 0;

export function issueCommand(
  entries: readonly CommandLedgerEntry[],
  input: { id?: string; sessionKey: string; text: string; now: number; afterRowKey?: string | undefined },
): { entries: CommandLedgerEntry[]; id: string } {
  const id = input.id ?? `cmd-${String(++nextLedgerId)}`;
  const entry: CommandLedgerEntry = {
    id,
    sessionKey: input.sessionKey,
    text: input.text,
    state: "pending",
    issuedAt: input.now,
    ...(input.afterRowKey === undefined ? {} : { afterRowKey: input.afterRowKey }),
  };
  const kept = [...entries, entry];
  const overflow = kept.length - LEDGER_CAP;
  if (overflow <= 0) return { entries: kept, id };
  const settledIds = kept.filter((row) => commandFinished(row)).slice(0, overflow).map((row) => row.id);
  return { entries: kept.filter((row) => !settledIds.includes(row.id)), id };
}

/**
 * Settle one row by its id. A live outcome (`accepted`, `running`) never reopens a finished row: a
 * command can finish on the session's stream before its own answer, which says only that the
 * daemon took it, is read.
 */
export function settleCommand(
  entries: readonly CommandLedgerEntry[],
  id: string,
  outcome: CommandOutcome & { now: number },
): CommandLedgerEntry[] {
  return entries.map((row) => row.id === id && (commandFinished(outcome) || !commandFinished(row))
    ? { ...row, state: outcome.state, settledAt: outcome.now, ...(outcome.resultText === undefined ? {} : { resultText: outcome.resultText }), ...(outcome.resultFormat === undefined ? {} : { resultFormat: outcome.resultFormat }), ...(outcome.resultFolded === undefined ? {} : { resultFolded: outcome.resultFolded }) }
    : row);
}

/** Live work - pending, accepted or running - is never evicted to make room. */
export function commandFinished(row: Pick<CommandLedgerEntry, "state">): boolean {
  return row.state === "ok" || row.state === "failed";
}

/** A row the daemon took and has not reported finished: it settles when the session goes idle. */
function awaitsIdle(row: Pick<CommandLedgerEntry, "state">): boolean {
  return row.state === "accepted" || row.state === "running";
}

/**
 * Settle every accepted or running row of one session once its daemon runtime is idle: a
 * forwarded command ran as the next turn and a parked reload ran on the idle edge, and neither
 * answers back with the row's id. A running row whose `command.settled` this page did not hear (it
 * was elsewhere, or reconnected after the frame went by) settles here too.
 */
export function settleIdleAwaitingCommands(entries: readonly CommandLedgerEntry[], sessionKey: string, now: number): CommandLedgerEntry[] {
  if (!entries.some((row) => row.sessionKey === sessionKey && awaitsIdle(row))) return [...entries];
  return entries.map((row) => row.sessionKey === sessionKey && awaitsIdle(row)
    ? { ...row, state: "ok", settledAt: now }
    : row);
}

/**
 * Re-key the rows of a session that got another id while staying the same session (a pending
 * start answered): a command sent before the start answered is still this session's, and its row
 * must render, and settle, under the id the session has now.
 */
export function moveCommandRows(entries: readonly CommandLedgerEntry[], fromKey: string, toKey: string): CommandLedgerEntry[] {
  return entries.map((row) => (row.sessionKey === fromKey ? { ...row, sessionKey: toKey } : row));
}

/**
 * Remove a row whose command answered with a tree dialog: the tree is the
 * acknowledgment and the navigation reports through the session itself.
 */
export function withdrawCommand(entries: readonly CommandLedgerEntry[], id: string): CommandLedgerEntry[] {
  return entries.filter((candidate) => candidate.id !== id);
}

/**
 * The rows this session may render; a key mismatch renders nothing of them.
 * Settled rows persist for the page's life (the owner's no-auto-leave ruling
 * and pi's own inline behavior): the only eviction is the capacity cap above.
 */
export function commandsForSession(entries: readonly CommandLedgerEntry[], sessionKey: string): CommandLedgerEntry[] {
  return entries.filter((row) => row.sessionKey === sessionKey);
}

export interface CommandDeliveryPresentation {
  readonly glyph: "pending" | "failed" | "single" | "double";
  readonly text: string;
  readonly label: string;
  readonly tone: "pending" | "received" | "delivered" | "failed";
}

const QUEUED: CommandDeliveryPresentation = { glyph: "single", text: "Queued", label: "Queued - the daemon has this command and runs it after the current reply", tone: "received" };
const RUNNING: CommandDeliveryPresentation = { glyph: "pending", text: "Running", label: "Running - sent to the daemon, which has not answered yet", tone: "pending" };
const HANDLER_RUNNING: CommandDeliveryPresentation = { glyph: "pending", text: "Running", label: "Running - the daemon took this command and its handler has not returned", tone: "pending" };
const NOT_SENT: CommandDeliveryPresentation = { glyph: "failed", text: "Not sent", label: "Not sent - the daemon did not take this command", tone: "failed" };

/**
 * How a command row reads, in the vocabulary of a sent message, by its state: a pending command is
 * queued behind the reply in flight or running now; an accepted one is queued; a running one (an
 * extension command whose handler has not returned) is running; a failed one was not taken. A
 * command that ran carries no mark, like a message the agent took: its result line, shown beneath
 * the bubble, says what happened, and "Read" was a status the owner ruled out (2026-09-30).
 */
const DELIVERY_PRESENTATION: Readonly<Record<CommandLedgerState, (streaming: boolean) => CommandDeliveryPresentation | undefined>> = {
  pending: (streaming) => (streaming ? QUEUED : RUNNING),
  accepted: () => QUEUED,
  running: () => HANDLER_RUNNING,
  ok: () => undefined,
  failed: () => NOT_SENT,
};

export function commandDeliveryPresentation(entry: Pick<CommandLedgerEntry, "state">, streaming: boolean): CommandDeliveryPresentation | undefined {
  return DELIVERY_PRESENTATION[entry.state](streaming);
}

function resultTextOf(entry: Pick<CommandLedgerEntry, "resultText">): string | undefined {
  return entry.resultText === "" ? undefined : entry.resultText;
}

/** The line under a command bubble, by its state; a failure with no text still says it failed. */
const RESULT_LINE: Readonly<Record<CommandLedgerState, (entry: Pick<CommandLedgerEntry, "resultText">) => string | undefined>> = {
  pending: () => undefined,
  accepted: (entry) => entry.resultText,
  running: () => undefined,
  ok: resultTextOf,
  failed: (entry) => resultTextOf(entry) ?? "The command failed; see the error above.",
};

export function commandResultLine(entry: Pick<CommandLedgerEntry, "state" | "resultText">): string | undefined {
  return RESULT_LINE[entry.state](entry);
}
