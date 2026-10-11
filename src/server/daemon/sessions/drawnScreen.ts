/**
 * A drawn screen while it is open: an extension's TUI component mounted in the daemon, driven by
 * the browser (state-diagram D2, "A drawn screen reads as a web card").
 *
 * The component is drawn at the width of the card that last asked for one, as pi's terminal draws
 * it at the terminal's width: an extension cuts its own lines to the width it is given, so a line
 * drawn wider than the card wrapped mid-word on a phone (owner, 2026-10-11, pi-prompt-history at 56
 * columns on a 47-column card). Every key, tap and resize redraws through one callback; the caller
 * publishes.
 */
import {
  EXTENSION_DIALOG_SCREEN_DEFAULT_WIDTH,
  EXTENSION_DIALOG_SCREEN_MAX_WIDTH,
  EXTENSION_DIALOG_SCREEN_MIN_WIDTH,
} from "../../../shared/apiTypes.js";
import { renderScreenView, type CustomScreenComponent } from "./customScreen.js";
import { walkScreenTo, type ScreenView } from "./screenView.js";
import { terminalKeyData } from "./terminalInput.js";

export interface DrawnScreen {
  /** The screen as it stands, at its current width. */
  view(): ScreenView;
  /** One key by name, as the browser names it (terminalInput.ts). */
  key(key: string): void;
  /** A tapped line, walked to on the redraws (screenView.ts). */
  select(line: number, text: string): void;
  /** Draw at another width; a width outside the bounds is brought inside them. */
  resize(width: number): void;
}

/** A width the daemon draws at: the columns asked for, brought inside the bounds. */
function screenWidth(width: number): number {
  return Math.min(EXTENSION_DIALOG_SCREEN_MAX_WIDTH, Math.max(EXTENSION_DIALOG_SCREEN_MIN_WIDTH, width));
}

export function driveScreen(component: CustomScreenComponent, redraw: (view: ScreenView) => void): DrawnScreen {
  let width = EXTENSION_DIALOG_SCREEN_DEFAULT_WIDTH;
  const view = (): ScreenView => renderScreenView(component, width);
  const press = (key: string): void => {
    const data = terminalKeyData(key);
    if (data !== undefined) component.handleInput?.(data);
  };
  const afterwards = (change: () => void): void => {
    try {
      change();
    } finally {
      redraw(view());
    }
  };
  return {
    view,
    key: (key) => { afterwards(() => { press(key); }); },
    select: (line, text) => { afterwards(() => { walkScreenTo({ press, view }, { line, text }); }); },
    resize: (requested) => {
      const next = screenWidth(requested);
      if (next === width) return;
      afterwards(() => {
        width = next;
        component.invalidate?.();
      });
    },
  };
}
