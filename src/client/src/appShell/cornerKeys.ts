/**
 * Which bar carries each of the shell's corner keys.
 *
 * Owner, 2026-10-16: as on the phone, the grid key holds the window's top-left corner and Go to its
 * top-right on every layout, whether or not a session is open, and the desktop's edge arrows are
 * gone. A key lives in whichever bar is at its corner now: the navigation panel's header while that
 * panel is open, the page column's bar while the column is on screen, the conversation's bar
 * otherwise. This replaces 2026-09-29, when both keys stood on the conversation's edges and moved
 * with the panels.
 *
 * The same day the owner added Back: over a page opened from Go to, the top-left of the place pages
 * show in holds Back, which returns to the Go to list. On the wide layout that place is the page
 * column; where pages replace the chat it is the conversation's bar, and Back covers the grid key
 * there (the Go to menu page carries the grid key instead, and Go to over a page closes the page).
 * A page holding the whole canvas hides both other bars, so its own bar carries every key: Back
 * over the page, the grid key over the list.
 */
export type CornerKeyBar = "conversation" | "navigation" | "column" | "none";

export interface CornerKeyLayout {
  /** The wide layout, where pages sit in a column beside the chat. */
  readonly pagesInColumn: boolean;
  /** A navigation panel beside the chat is open; never on the phone. */
  readonly navigationPanelOpen: boolean;
  readonly columnOnScreen: boolean;
  readonly columnHoldsCanvas: boolean;
  /** A page, not the Go to list, fills the place pages show in. */
  readonly pageShown: boolean;
}

export interface CornerKeyBars {
  readonly grid: CornerKeyBar;
  readonly back: CornerKeyBar;
  readonly goTo: CornerKeyBar;
}

export function cornerKeyBars(layout: CornerKeyLayout): CornerKeyBars {
  const navigation: CornerKeyBar | undefined = layout.navigationPanelOpen ? "navigation" : undefined;
  if (layout.columnHoldsCanvas) return { grid: layout.pageShown ? "none" : "column", back: layout.pageShown ? "column" : "none", goTo: "column" };
  if (layout.pagesInColumn) {
    return {
      grid: navigation ?? "conversation",
      back: layout.columnOnScreen && layout.pageShown ? "column" : "none",
      goTo: layout.columnOnScreen ? "column" : "conversation",
    };
  }
  if (layout.pageShown) return { grid: navigation ?? "none", back: "conversation", goTo: "conversation" };
  return { grid: navigation ?? "conversation", back: "none", goTo: "conversation" };
}

/**
 * What Go to does now (owner, 2026-10-16): Go to closes whatever it shows, the list or a page, and
 * opens the list when nothing is shown. On the wide layout that is the page column, folded or opened
 * with the list over it; elsewhere a page shown in place of the chat closes, or the menu sheet toggles.
 */
export type GoToAction = "foldColumn" | "openColumnList" | "closePage" | "toggleSheet";

export function goToAction(state: { pagesInColumn: boolean; columnOnScreen: boolean; pageShown: boolean }): GoToAction {
  if (state.pagesInColumn) return state.columnOnScreen ? "foldColumn" : "openColumnList";
  return state.pageShown ? "closePage" : "toggleSheet";
}

/** The keys that can hold a key's corner, that key first: Back covers the grid key in the top-left. */
export const KEYS_AT_CORNER: Record<keyof CornerKeyBars, readonly (keyof CornerKeyBars)[]> = {
  grid: ["grid", "back"],
  back: ["back", "grid"],
  goTo: ["goTo"],
};

export type LeadingKey = "grid" | "back" | "none";

export function leadingKeyOf(keys: CornerKeyBars, bar: CornerKeyBar): LeadingKey {
  if (keys.back === bar) return "back";
  return keys.grid === bar ? "grid" : "none";
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
