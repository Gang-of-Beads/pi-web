export interface RunCountFrame {
  hadPreviousStatus: boolean;
  previousCount: number | undefined;
  currentCount: number | undefined;
}

export function backgroundRunCountChanged(frame: RunCountFrame): boolean {
  if (!frame.hadPreviousStatus) return false;
  return (frame.currentCount ?? 0) !== (frame.previousCount ?? 0);
}
