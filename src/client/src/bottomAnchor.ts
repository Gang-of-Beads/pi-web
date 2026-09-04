export type BottomAnchorAction = "hold-bottom" | "leave-alone";

export interface BottomAnchorInput {
  pinnedToBottom: boolean;
  userScrolling: boolean;
  previousHeight: number | undefined;
  currentHeight: number;
}

/**
 * A pinned reader aims at the bottom - the ask card, the queued strip, the
 * newest reply all live there - so for them the bottom edge is the ground and
 * it is held even while a finger is down. Growth with a frozen scroll slides
 * the last row down under the finger, which is exactly the six-times-reported
 * two-tap theft; holding the edge is what keeps the aimed option still. A
 * reader who scrolled away keeps their reading position untouched, and a
 * gesture in flight is never fought.
 */
export function bottomAnchorAction(input: BottomAnchorInput): BottomAnchorAction {
  if (!input.pinnedToBottom || input.userScrolling) return "leave-alone";
  if (input.previousHeight === undefined || input.currentHeight <= input.previousHeight) return "leave-alone";
  return "hold-bottom";
}
