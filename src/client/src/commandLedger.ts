/**
 * The browser's own record of the commands it has issued.
 *
 * This mirrors pi's own TUI: a slash command is not a message and writes no
 * transcript entry (the model never sees it); the result is shown inline
 * where the command was issued and stays there for the life of the page.
 * The daemon runs it behind whatever turn is in flight, and until it
 * answers, a row is the only evidence the press happened - the owner once
 * pressed goal Resume four times against a command accepted every time.
 *
 * The ledger is a client-side projection, not server truth: rows are scoped
 * to the session key they were issued under - a row must never render
 * beneath another session's transcript - and read with the same delivery
 * vocabulary as a sent message, so one bubble grammar covers both.
 */

import type { CommandResult } from "../../shared/apiTypes";

export type CommandLedgerSource = "typed" | "goal-panel";

export type CommandLedgerState = "pending" | "ok" | "failed";

/**
 * What a command's own result means for its receipt.
 *
 * The receipt used to be settled by whether the request threw, which is a
 * statement about the network, not about the command. A refusal travels as a
 * perfectly successful response, so "/new done" was displayed beside the
 * server's own "/new is not implemented in the web UI yet" - two receipts for
 * one action, disagreeing, and a reader believes the green one.
 *
 * Undefined means the command has not settled: a select or tree result opens a
 * dialog and the command is still waiting on the reader.
 */
export function commandOutcomeFor(result: CommandResult): { state: "ok" | "failed"; resultText?: string } | undefined {
  if (result.type === "select" || result.type === "tree") return undefined;
  if (result.type === "unsupported") return { state: "failed", resultText: result.message };
  return result.message === undefined || result.message === ""
    ? { state: "ok" }
    : { state: "ok", resultText: result.message };
}

export interface CommandLedgerEntry {
  readonly id: string;
  /** machine+session identity the command was issued under. */
  readonly sessionKey: string;
  readonly text: string;
  readonly source: CommandLedgerSource;
  readonly state: CommandLedgerState;
  readonly issuedAt: number;
  /** Failure text, or a one-line result when the command produced one. */
  readonly resultText?: string;
  readonly settledAt?: number;
}

/** Most rows one session keeps; older settled rows drop first. */
const LEDGER_CAP = 20;

let nextLedgerId = 0;

export function issueCommand(
  entries: readonly CommandLedgerEntry[],
  input: { sessionKey: string; text: string; source: CommandLedgerSource; now: number },
): { entries: CommandLedgerEntry[]; id: string } {
  const id = `cmd-${String(++nextLedgerId)}`;
  const entry: CommandLedgerEntry = {
    id,
    sessionKey: input.sessionKey,
    text: input.text,
    source: input.source,
    state: "pending",
    issuedAt: input.now,
  };
  const kept = [...entries, entry];
  const overflow = kept.length - LEDGER_CAP;
  if (overflow <= 0) return { entries: kept, id };
  // Drop the oldest settled rows first; pending rows represent live work and
  // are never dropped to make room.
  const settledIds = kept.filter((row) => row.state !== "pending").slice(0, overflow).map((row) => row.id);
  return { entries: kept.filter((row) => !settledIds.includes(row.id)), id };
}

export function settleCommand(
  entries: readonly CommandLedgerEntry[],
  id: string,
  outcome: { state: "ok" | "failed"; resultText?: string; now: number },
): CommandLedgerEntry[] {
  return entries.map((row) => row.id === id
    ? { ...row, state: outcome.state, settledAt: outcome.now, ...(outcome.resultText === undefined ? {} : { resultText: outcome.resultText }) }
    : row);
}

/**
 * Remove a row whose command answered with a dialog.
 *
 * Dismissal deliberately refuses a pending row, so that a receipt still
 * waiting for its outcome cannot be swept away. A command that opens a dialog
 * never gets an outcome - the dialog is the acknowledgment - so without this
 * its row would stay pending forever, undismissable and exempt from the cap.
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

/**
 * How a command row reads, in the vocabulary of a sent message: a pending
 * command is queued behind the reply in flight or running now; a settled one
 * was read by the daemon, or was not taken at all. The result text, when the
 * command produced one, is shown beneath the bubble rather than in the mark.
 */
export function commandDeliveryPresentation(entry: Pick<CommandLedgerEntry, "state">, streaming: boolean): CommandDeliveryPresentation {
  if (entry.state === "pending") {
    return streaming
      ? { glyph: "single", text: "Queued", label: "Queued - the daemon runs this command after the current reply", tone: "received" }
      : { glyph: "pending", text: "Running", label: "Running - the daemon is executing this command", tone: "pending" };
  }
  if (entry.state === "ok") return { glyph: "double", text: "Read", label: "Read - the daemon ran this command", tone: "delivered" };
  return { glyph: "failed", text: "Not sent", label: "Not sent - the daemon did not take this command", tone: "failed" };
}

/** The line under a settled command bubble; a failure with no text still says it failed. */
export function commandResultLine(entry: Pick<CommandLedgerEntry, "state" | "resultText">): string | undefined {
  if (entry.state === "pending") return undefined;
  if (entry.resultText !== undefined && entry.resultText !== "") return entry.resultText;
  return entry.state === "failed" ? "The command failed; see the error above." : undefined;
}
