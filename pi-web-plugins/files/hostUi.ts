import type { CSSResultGroup } from "lit";
import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities this plugin was activated with.
 *
 * The panels are custom elements, so their styles are read when the module is
 * first imported - before any call could hand them in. The plugin therefore
 * records what the host gave it and imports the elements afterwards, which is
 * why this holder exists rather than a parameter. Absent means the host
 * offered none: the elements then copy nothing and simply go without, because
 * copying the host's styles or wording would drift the moment either side
 * changed.
 */

let hostUi: PluginHostUi | undefined;

export function rememberFilesHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function filesSurfaceStyles(): CSSResultGroup[] {
  return hostUi === undefined ? [] : [hostUi.surfaceStyles];
}

export function filesTextStyles(): CSSResultGroup[] {
  return hostUi === undefined ? [] : [hostUi.textStyles];
}

export function describeFilesError(error: unknown): string {
  return hostUi === undefined ? String(error) : hostUi.describeError(error);
}

export function filesRenderMarkdownHtml(markdown: string): string {
  return hostUi === undefined ? "" : hostUi.renderMarkdownHtml(markdown);
}

export function filesRegisterModal(registration: {
  element: HTMLElement;
  paintElement?: HTMLElement;
  focus?: () => void;
  onTopChange?: (isTop: boolean) => void;
}): { readonly isTop: boolean; focus(): boolean; unregister(): void } | undefined {
  return hostUi?.registerModal(registration);
}

export function filesQuery(): PluginHostUi["query"] | undefined {
  return hostUi?.query;
}
