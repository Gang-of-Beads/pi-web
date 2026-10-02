/**
 * Which workspace page is shown, and whether it holds the whole canvas.
 *
 * The no-row review (`4d54a383`) found a desktop page stranded under a hidden
 * app bar with no way out: a link restored any page into the canvas, and a
 * page opened from the quick switcher inherited the previous page's request.
 * The host stores only the request; holding the canvas is derived here on
 * every read, so a page holds it only when all of these are true:
 * - it was asked for this very page, not for one that is missing and replaced
 *   by the first page;
 * - the page declared it can (`fullscreen`);
 * - the window is wide enough to show it (the desktop side-by-side layout);
 * - the workspace panel is on screen. A panel the reader folded away is
 *   hidden by its own rule, so holding the canvas with it would hide the app
 *   bar, the chat and the page at once (review `671724cc`).
 * When the window narrows or the panel is folded the request is kept, and the
 * page returns to the canvas when the window widens or the panel opens again.
 */

interface CanvasPage {
  readonly id: string;
  readonly fullscreen?: boolean | undefined;
}

/** The page a tool id shows: the named page, or the first one when it is not here. */
export function shownWorkspacePanel<T extends { readonly id: string }>(panels: readonly T[], tool: string): T | undefined {
  return panels.find((panel) => panel.id === tool) ?? panels[0];
}

/** Whether the page shown for `tool` is that page and declared it can take the canvas. */
export function workspacePanelMayHoldCanvas(tool: string, shown: CanvasPage | undefined): boolean {
  return shown?.id === tool && shown.fullscreen === true;
}

/** Whether the shown page holds the canvas now. */
export function workspacePanelHoldsCanvas(facts: {
  readonly requested: boolean;
  readonly windowShowsCanvas: boolean;
  readonly panelOnScreen: boolean;
  readonly tool: string;
  readonly shown: CanvasPage | undefined;
}): boolean {
  return facts.requested && facts.windowShowsCanvas && facts.panelOnScreen && workspacePanelMayHoldCanvas(facts.tool, facts.shown);
}
