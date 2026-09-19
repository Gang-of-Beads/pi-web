/**
 * Two fingers change the terminal's type size.
 *
 * A phone terminal is read at whatever size the shell happens to print; the
 * only way to make it legible was to zoom the whole page, which then scrolls
 * the app instead of the terminal. Pinching changes the font size the terminal
 * renders at, and the caller refits so the pty learns the new column count.
 *
 * The scale is clamped: below 8px the output is unreadable, above 28px a
 * single line no longer fits a phone, and both ends print nonsense at the pty.
 */

export const MIN_TERMINAL_FONT_SIZE = 8;
export const MAX_TERMINAL_FONT_SIZE = 28;

export interface PinchState {
  startDistance: number;
  startFontSize: number;
}

export function pinchDistance(points: readonly { clientX: number; clientY: number }[]): number | undefined {
  const [first, second] = points;
  if (first === undefined || second === undefined) return undefined;
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

export function clampTerminalFontSize(size: number): number {
  if (!Number.isFinite(size)) return MIN_TERMINAL_FONT_SIZE;
  return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(size)));
}

/**
 * The size a pinch asks for, or undefined when the gesture has not moved
 * enough to change a whole pixel - resizing on every frame made the pty
 * renegotiate its columns continuously.
 */
export function pinchFontSize(state: PinchState, distance: number, current: number): number | undefined {
  if (state.startDistance <= 0 || distance <= 0) return undefined;
  const next = clampTerminalFontSize(state.startFontSize * (distance / state.startDistance));
  return next === current ? undefined : next;
}
