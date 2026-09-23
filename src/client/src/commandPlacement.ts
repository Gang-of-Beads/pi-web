import type { CommandLedgerEntry } from "./commandLedger";

/**
 * Where a command bubble belongs in the transcript.
 *
 * A command row used to be drawn only in the tail, after every message, so a
 * `/goal` that started the turn sat under the reply it caused and read as
 * something still waiting - reported as "why is this slash message always
 * here". The row is a message like any other: it was issued at a moment, so it
 * belongs at that moment, and only a command newer than everything on screen
 * stays in the tail.
 *
 * Placement is by issue time against each group's first message. A group with
 * no timestamp cannot order anything, so rows fall past it.
 */
export interface CommandPlacement {
  /** Rows to draw immediately before the group at this index. */
  before: Map<number, CommandLedgerEntry[]>;
  /** Rows issued after everything on screen, or with nothing to order against. */
  tail: CommandLedgerEntry[];
}

export function placeCommands(
  entries: readonly CommandLedgerEntry[],
  groupTimestamps: readonly (number | undefined)[],
): CommandPlacement {
  const before = new Map<number, CommandLedgerEntry[]>();
  const tail: CommandLedgerEntry[] = [];
  for (const entry of entries) {
    const index = groupTimestamps.findIndex((at) => at !== undefined && at > entry.issuedAt);
    if (index === -1) {
      tail.push(entry);
      continue;
    }
    const rows = before.get(index);
    if (rows === undefined) before.set(index, [entry]);
    else rows.push(entry);
  }
  return { before, tail };
}
