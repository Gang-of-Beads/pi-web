/**
 * Whether the phone's on-screen keyboard is up over the terminal, for the floating keyboard button
 * that raises it and hides while it is up (owner, 2026-10-13).
 *
 * No browser reports the keyboard itself. The terminal's input holding focus is necessary but not
 * enough: Android's back gesture closes the keyboard and leaves the focus where it was. The visible
 * height is the other half, read against the screen rather than the layout viewport, because the
 * app's `interactive-widget=resizes-content` makes Chromium shrink both together (the host's
 * `keyboardInset.ts` reads ~0 there). A keyboard takes about 40% of a phone's height; the browser's
 * own bars take far less than a quarter.
 */
const KEYBOARD_VISIBLE_RATIO = 0.75;

export function softKeyboardShown(inputFocused: boolean, visibleHeight: number | undefined, screenHeight: number): boolean {
  if (!inputFocused) return false;
  if (visibleHeight === undefined || !Number.isFinite(screenHeight) || screenHeight <= 0) return true;
  return visibleHeight < screenHeight * KEYBOARD_VISIBLE_RATIO;
}
