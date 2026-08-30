/**
 * The browser's own record of the commands it has issued.
 *
 * A slash command takes a route that never touches the transcript: no message,
 * no pending row, no receipt. The daemon runs it behind whatever turn is in
 * flight, and until it answers, the screen holds no evidence the press
 * happened - which is why the owner pressed goal Resume four times against a
 * command that had been accepted every time.
 *
 * The ledger is a client-side projection, not server truth: rows are labelled
 * as the browser's record, retired once settled and acknowledged, and scoped
 * to the session key they were issued under - a row must never render beneath
 * another session's transcript.
 */

export type CommandLedgerSource = "typed" | "goal-panel";

export type CommandLedgerState = "pending" | "ok" | "failed";

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

/** How long a settled row stays visible as the press's acknowledgment. */
export const SETTLED_ROW_LINGER_MS = 8_000;

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

/** Settled rows leave after their linger; pending rows never expire here. */
export function expireSettledCommands(entries: readonly CommandLedgerEntry[], now: number): CommandLedgerEntry[] {
  const kept = entries.filter((row) => row.state === "pending" || row.settledAt === undefined || now - row.settledAt < SETTLED_ROW_LINGER_MS);
  return kept.length === entries.length ? [...entries] : kept;
}

/** The rows this session may render; a key mismatch renders nothing of them. */
export function commandsForSession(entries: readonly CommandLedgerEntry[], sessionKey: string): CommandLedgerEntry[] {
  return entries.filter((row) => row.sessionKey === sessionKey);
}
