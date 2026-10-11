import { EXTENSION_DIALOG_SCREEN_MAX_WIDTH, EXTENSION_DIALOG_SCREEN_MIN_WIDTH } from "../../shared/apiTypes";

/**
 * How many columns a drawn screen's card has room for, so the daemon draws the extension at that
 * width and the extension cuts its own lines, as pi's terminal draws at the terminal's width (state
 * diagram D2, 2026-10-11): drawn at 56 columns, a 47-column phone card wrapped lines mid-word.
 *
 * Measured on the element a line is drawn in: its content box divided by the width of a digit in
 * the font that line uses. Exact only when that font is monospace (the plain screen, --pi-font-mono);
 * a styled screen inherits the UI font, so with a proportional font wide glyphs can still wrap a
 * line of this many columns. Undefined where nothing can be measured (no layout, no canvas).
 */
export function screenColumns(line: Element): number | undefined {
  const style = getComputedStyle(line);
  const room = line.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  const digit = digitWidth(style.font);
  if (!Number.isFinite(room) || room <= 0 || digit === undefined || digit <= 0) return undefined;
  return Math.min(EXTENSION_DIALOG_SCREEN_MAX_WIDTH, Math.max(EXTENSION_DIALOG_SCREEN_MIN_WIDTH, Math.floor(room / digit)));
}

const SAMPLE = "0000000000";

function digitWidth(font: string): number | undefined {
  const context = document.createElement("canvas").getContext("2d");
  if (context === null) return undefined;
  context.font = font;
  return context.measureText(SAMPLE).width / SAMPLE.length;
}

/**
 * Why a card would ask for its width: it opened or its own width changed, or the reader used it.
 * Two pages showing one screen at different widths would take turns redrawing it if every redraw
 * made the other ask again, so a redraw alone asks nothing: the screen follows the card last
 * opened, resized or used.
 */
export type WidthReason = "measured" | "used";

export function asksForWidth(reason: WidthReason, columns: number | undefined, drawnAt: number | undefined, lastAsked: number | undefined): boolean {
  if (columns === undefined || columns === drawnAt) return false;
  const ask: Record<WidthReason, boolean> = { measured: columns !== lastAsked, used: true };
  return ask[reason];
}
