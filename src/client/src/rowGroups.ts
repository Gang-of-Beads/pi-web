/**
 * One margin group per kind of row, so a row never invents its own padding.
 *
 * The transcript kept being nudged one selector at a time - the live-events summary here,
 * the activity row there - and the phone drifted out of line with the desktop. A row kind
 * now belongs to a group, the group carries the margin, and a new kind is classified once.
 */
export type RowGroup = "card" | "bare";

export interface RowGroupMembership {
  readonly group: RowGroup;
  readonly selectors: readonly string[];
}

export const ROW_GROUPS: Record<RowGroup, RowGroupMembership> = {
  /** Rows that draw their own box: the card's own padding is the text inset. */
  card: { group: "card", selectors: [".msg:not(.event-group):not(.tool-execution-shell):not(.ask-user-record-shell)"] },
  /** Rows that draw no box: they must add the same inset the cards do. */
  bare: {
    group: "bare",
    selectors: [".msg.event-group > summary", ".group-msg", ".session-activity", ".waiting-slot"],
  },
};

/** Every selector the groups claim, so a test can catch an unclassified row. */
export function groupedSelectors(): string[] {
  return Object.values(ROW_GROUPS).flatMap((membership) => [...membership.selectors]);
}
