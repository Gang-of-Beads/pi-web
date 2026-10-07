import type { ExtensionWidgetStanding } from "../../shared/apiTypes";

/**
 * One Go to key per pi extension that drew with `setWidget` in the session on screen
 * (extension-keys-in-go-to.md). An extension a shown page fronts brings none: that page is its key.
 * The daemon names the surface an extension backs; only a page on screen that fronts it takes the
 * widget, so a plugin whose page is missing here (its browser module failed, or it was disabled before
 * the daemon restarted) leaves the extension its own key rather than nowhere. A widget no loaded
 * extension could be matched to stands under its own key name.
 */
export interface ExtensionWidgetPage {
  /** Stable for the extension, safe in a contribution id. */
  readonly id: string;
  readonly title: string;
  readonly widgets: readonly { readonly key: string; readonly lines: readonly string[] }[];
}

export function extensionWidgetPages(widgets: readonly ExtensionWidgetStanding[] | undefined, frontedSurfaces: ReadonlySet<string>): ExtensionWidgetPage[] {
  const pages = new Map<string, { title: string; widgets: { key: string; lines: readonly string[] }[] }>();
  for (const widget of widgets ?? []) {
    const surface = widget.extension?.surface;
    if (surface !== undefined && frontedSurfaces.has(surface)) continue;
    const id = widget.extension === undefined ? `key-${slug(widget.key)}` : widget.extension.id;
    const title = widget.extension?.title ?? widget.key;
    const page = pages.get(id) ?? { title, widgets: [] };
    page.widgets.push({ key: widget.key, lines: widget.lines });
    pages.set(id, page);
  }
  return [...pages]
    .map(([id, page]) => ({ id, title: page.title, widgets: page.widgets }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

/** A widget key as a contribution id segment (`[a-z0-9.-]`), so the page survives a reload of its route. */
function slug(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9.-]+/gu, "-") || "widget";
}

/** Whether the extension shows anything now; a page of cleared widgets says it shows nothing. */
export function pageShowsNothing(page: ExtensionWidgetPage): boolean {
  return page.widgets.every((widget) => widget.lines.length === 0);
}
