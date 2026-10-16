/**
 * Which bar carries the shell's two corner keys.
 *
 * Owner, 2026-10-16: as on the phone, the grid key holds the window's top-left corner and Go to its
 * top-right on every layout, whether or not a session is open, and the desktop's edge arrows are
 * gone. A key lives in whichever bar is at its corner now: the navigation panel's header while that
 * panel is open, the page column's bar while the column is on screen, the conversation's bar
 * otherwise. A page holding the whole canvas hides both other bars, so its own bar carries both keys
 * and the reader always has a way back. This replaces 2026-09-29, when both keys stood on the
 * conversation's edges and moved with the panels.
 *
 * On the phone one surface shows at a time: the conversation's bar carries both keys, and the
 * navigation page, which replaces the conversation, carries both in its own header.
 */
export type CornerKeyBar = "conversation" | "navigation" | "column";

export interface CornerKeyLayout {
  readonly phone: boolean;
  readonly navigationPanelOpen: boolean;
  readonly columnOnScreen: boolean;
  readonly columnHoldsCanvas: boolean;
}

export interface CornerKeyBars {
  readonly grid: CornerKeyBar;
  readonly goTo: CornerKeyBar;
}

export function cornerKeyBars(layout: CornerKeyLayout): CornerKeyBars {
  if (layout.phone) return { grid: "conversation", goTo: "conversation" };
  if (layout.columnHoldsCanvas) return { grid: "column", goTo: "column" };
  return {
    grid: layout.navigationPanelOpen ? "navigation" : "conversation",
    goTo: layout.columnOnScreen ? "column" : "conversation",
  };
}

/**
 * The navigation page's grid key: back over a page it covers, folding the panel it sits in, or
 * standing with nowhere to go. On a phone with no session behind the page the key still stands, as
 * pressed as it is everywhere on that page, doing nothing (owner, 2026-10-16: not greyed out).
 */
export type NavigateGridKey = "return" | "fold" | "stay";


export function navigateGridKey(state: { overlay: boolean; phone: boolean; hasChatSubject: boolean }): NavigateGridKey {
  if (state.overlay) return "return";
  if (!state.phone) return "fold";
  return state.hasChatSubject ? "return" : "stay";
}
