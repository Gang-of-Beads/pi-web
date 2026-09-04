import type { CSSResultGroup } from "lit";
import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities this plugin was activated with.
 *
 * The panel is a custom element, so its styles are read when its module is
 * first imported - before any call could hand them in. The plugin therefore
 * records what the host gave it and imports the panel afterwards, which is why
 * this holder exists rather than a parameter. Absent means the host offered
 * none: the panel then copies nothing and simply goes without, because copying
 * the host's clipboard chain or its wording would drift the moment either side
 * changed.
 */

let hostUi: PluginHostUi | undefined;

export function rememberTerminalHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function terminalSurfaceStyles(): CSSResultGroup[] {
  return hostUi === undefined ? [] : [hostUi.surfaceStyles];
}

export function copyTerminalText(text: string): Promise<boolean> {
  return hostUi === undefined ? Promise.resolve(false) : hostUi.copyText(text);
}

export function describeTerminalError(error: unknown): string {
  return hostUi === undefined ? String(error) : hostUi.describeError(error);
}

export function coarseOrMobileQuery(): string | undefined {
  return hostUi?.breakpoints.coarseOrMobile;
}
