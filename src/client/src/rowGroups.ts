/**
 * One margin group per kind of row, so a row never invents its own padding.
 *
 * The transcript kept being nudged one selector at a time - the live-events summary here,
 * the activity row there - and the phone drifted out of line with the desktop. A row kind
 * now belongs to a group, the group carries the margin, and a new kind is classified once.
 */
export type RowGroup = "card" | "bare" | "holder";

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
    selectors: [".msg.event-group > summary", ".session-activity", ".msg-notice"],
  },
  /**
   * Rows whose inset is already paid by what holds them or what they hold: the open
   * question and dialog cards draw their own box, and a live-events row sits inside
   * .group-body, which carries the group's inset. They add nothing. (The answered-question
   * shell zeroes all its padding in its own rule, so it needs no entry here.) An inset here is paid
   * twice - how the question card ended up a gutter narrower than every message, and how
   * tool boxes inside live events went from 12px to 22px (phone) and 24px (desktop) in.
   */
  holder: { group: "holder", selectors: [".waiting-slot", ".group-msg"] },
};

/** Every selector the groups claim, so a test can catch an unclassified row. */
export function groupedSelectors(): string[] {
  return Object.values(ROW_GROUPS).flatMap((membership) => [...membership.selectors]);
}
