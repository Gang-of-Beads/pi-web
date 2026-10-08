/**
 * The open session's row keeps its place in the session lists until the reader leaves it (owner,
 * 2026-10-08, ask 28c79ba5: "A stays where it is until you leave it").
 *
 * An unread session ranks above the read ones (`sessionOrder.ts`). Opening one marks it read, its
 * rank dropped, and the list animated the row the reader had just tapped down past the others while
 * the chat opened. While the reader has it open, the lists rank it as still unread; the read mark
 * itself is not held, only the place. Opening another session, or none, releases the hold, and the
 * row then takes its read place. Every other row keeps sorting live.
 */
export interface OpenRow {
  readonly machineId: string;
  readonly sessionId: string;
}

/** What the open row did since the last look. */
type OpenRowMove = "left" | "still-open" | "opened-unread" | "opened-read";

function openRowMove(held: OpenRow | undefined, open: OpenRow | undefined, unread: ReadonlySet<string>): OpenRowMove {
  if (open === undefined) return "left";
  if (held?.machineId === open.machineId && held.sessionId === open.sessionId) return "still-open";
  return unread.has(open.sessionId) ? "opened-unread" : "opened-read";
}

const NEXT_HOLD: Readonly<Record<OpenRowMove, (held: OpenRow | undefined, open: OpenRow | undefined) => OpenRow | undefined>> = {
  left: () => undefined,
  "still-open": (held) => held,
  "opened-unread": (_held, open) => open,
  "opened-read": () => undefined,
};

/**
 * The hold after a look at the open row. `unread` is the open row's machine's unread set as it
 * stands now, so the look must come before the open session is marked read.
 */
export function nextOpenRowHold(held: OpenRow | undefined, open: OpenRow | undefined, unread: ReadonlySet<string>): OpenRow | undefined {
  return NEXT_HOLD[openRowMove(held, open, unread)](held, open);
}

/** The session a list of `machineId`'s rows ranks as still unread; undefined when the hold is elsewhere. */
export function heldOpenSessionIn(held: OpenRow | undefined, machineId: string): string | undefined {
  return held?.machineId === machineId ? held.sessionId : undefined;
}
