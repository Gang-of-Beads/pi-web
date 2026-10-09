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
 * Placement is by issue time against each group's first message: a command goes
 * after the last group stamped at or before it, so nothing that happened before
 * it is drawn below it. A group with no timestamp cannot order anything, so rows
 * fall past it. The stamps do not rise steadily: a tool row carries the time it
 * ended and a committed message the time it was sent, so "before the first group
 * stamped later" drew a command typed during a bash run above that run and above
 * a message sent before it (B2, probe-row-order.mjs).
 *
 * So a command that recorded the row before it is drawn right after that row,
 * found by key among the slots, and the timestamp rule is left to a command whose
 * row is not on the page (D1, #226).
 */
export interface CommandPlacement {
  /** Rows to draw immediately before the slot (settled group or waiting row) at this index. */
  before: Map<number, CommandLedgerEntry[]>;
  /** Rows anchored after the last slot, issued after every slot, or with nothing to order against. */
  tail: CommandLedgerEntry[];
}

export function placeCommands(
  entries: readonly CommandLedgerEntry[],
  groupTimestamps: readonly (number | undefined)[],
  groupKeys: readonly (readonly string[])[] = [],
): CommandPlacement {
  const before = new Map<number, CommandLedgerEntry[]>();
  const tail: CommandLedgerEntry[] = [];
  for (const entry of entries) {
    const anchor = entry.afterRowKey === undefined ? -1 : groupKeys.reduce<number>((last, keys, position) => (keys.includes(entry.afterRowKey ?? "") ? position : last), -1);
    const index = anchor === -1 ? issueTimeSlot(entry, groupTimestamps) : anchor + 1 < groupTimestamps.length ? anchor + 1 : -1;
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

function issueTimeSlot(entry: CommandLedgerEntry, groupTimestamps: readonly (number | undefined)[]): number {
  const lastBefore = groupTimestamps.reduce<number>((last, at, position) => (at !== undefined && at <= entry.issuedAt ? position : last), -1);
  return groupTimestamps.findIndex((at, position) => position > lastBefore && at !== undefined);
}
