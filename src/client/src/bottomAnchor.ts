export type BottomAnchorAction = "hold-bottom" | "leave-alone";

export interface BottomAnchorInput {
  pinnedToBottom: boolean;
  readerHoldsGround: boolean;
  userScrolling: boolean;
  previousHeight: number | undefined;
  currentHeight: number;
}

export function bottomAnchorAction(input: BottomAnchorInput): BottomAnchorAction {
  if (!input.pinnedToBottom || input.readerHoldsGround || input.userScrolling) return "leave-alone";
  if (input.previousHeight === undefined || input.currentHeight <= input.previousHeight) return "leave-alone";
  return "hold-bottom";
}
