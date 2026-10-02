/**
 * Which workspace page is shown, and whether it holds the whole canvas.
 *
 * The no-row review (`4d54a383`) found a desktop page stranded under a hidden
 * app bar with no way out: a link restored any page into the canvas, and a
 * page opened from the quick switcher inherited the previous page's request.
 * The host stores only the request; holding the canvas is derived here on
 * every read from the request and the page actually shown, so a page that did
 * not declare `fullscreen` can never hold it.
 */

/** The page a tool id shows: the named page, or the first one when it is not here. */
export function shownWorkspacePanel<T extends { readonly id: string }>(panels: readonly T[], tool: string): T | undefined {
  return panels.find((panel) => panel.id === tool) ?? panels[0];
}

/** Whether the shown page holds the canvas: it was asked for, and the page declared it can. */
export function workspacePanelHoldsCanvas(requested: boolean, shown: { readonly fullscreen?: boolean | undefined } | undefined): boolean {
  return requested && shown?.fullscreen === true;
}
