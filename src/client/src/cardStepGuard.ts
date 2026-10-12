/**
 * Whether an option change so soon after a step change is the reader's.
 *
 * The step's controls are replaced under the finger: tapping Next renders the
 * next field where the old one stood, and the tail of that same gesture -
 * the click a touch screen sends after pointerup, or a second contact from a
 * fast tapper - lands on whatever now occupies that spot. The owner reported
 * it as "Next keeps selecting Custom", because Custom sits at the bottom of a
 * choice field where Next was. A change arriving inside the guard window belongs
 * to the gesture that moved the step, not to the field now on screen.
 */
export const CARD_STEP_GUARD_MS = 350;

export function acceptsOptionChange(input: { now: number; stepChangedAt: number | undefined }): boolean {
  if (input.stepChangedAt === undefined) return true;
  return input.now - input.stepChangedAt >= CARD_STEP_GUARD_MS;
}
