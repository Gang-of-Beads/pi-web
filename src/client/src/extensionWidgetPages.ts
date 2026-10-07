import type { ExtensionWidgetStanding } from "../../shared/apiTypes";

/**
 * One Go to key per pi extension that drew with `setWidget` in the session on screen
 * (extension-keys-in-go-to.md). An extension a plugin fronts brings none: its plugin's page is its
 * key. A widget no loaded extension could be matched to stands under its own key name.
 */
export interface ExtensionWidgetPage {
  /** Stable for the extension, safe in a contribution id. */
  readonly id: string;
  readonly title: string;
  readonly widgets: readonly { readonly key: string; readonly lines: readonly string[] }[];
}

export function extensionWidgetPages(widgets: readonly ExtensionWidgetStanding[] | undefined): ExtensionWidgetPage[] {
  const pages = new Map<string, { title: string; widgets: { key: string; lines: readonly string[] }[] }>();
  for (const widget of widgets ?? []) {
    if (widget.extension?.surface !== undefined) continue;
    const id = widget.extension === undefined ? `key-${encodeURIComponent(widget.key)}` : widget.extension.id;
    const title = widget.extension?.title ?? widget.key;
    const page = pages.get(id) ?? { title, widgets: [] };
    page.widgets.push({ key: widget.key, lines: widget.lines });
    pages.set(id, page);
  }
  return [...pages]
    .map(([id, page]) => ({ id, title: page.title, widgets: page.widgets }))
    .sort((left, right) => left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
}

/** Whether the extension shows anything now; a page of cleared widgets says it shows nothing. */
export function pageShowsNothing(page: ExtensionWidgetPage): boolean {
  return page.widgets.every((widget) => widget.lines.length === 0);
}
