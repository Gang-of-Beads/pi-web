import type { PluginHostUi, PluginReadFailure } from "@gang-of-beads/pi-web/plugin-api";

/**
 * The host utilities this plugin was activated with.
 *
 * `static styles` freezes at module load, which runs before the host is
 * remembered - the panel module is imported for its side effects by the plugin
 * entry before activate() runs - so the host sheets are adopted per element
 * instance in createRenderRoot instead. Absent means the host offered none:
 * the panel then adopts nothing and simply goes without, because copying the
 * host's clipboard chain or its wording would drift the moment either side
 * changed.
 */

let hostUi: PluginHostUi | undefined;

export function rememberTerminalHostUi(ui: PluginHostUi | undefined): void {
  hostUi = ui;
}

export function adoptTerminalHostStyles(root: ShadowRoot): void {
  if (hostUi === undefined) return;
  hostUi.adoptSheets?.(root, [hostUi.surfaceStyles, hostUi.workspacePanelStyles, ...(hostUi.actionMenuStyles === undefined ? [] : [hostUi.actionMenuStyles])]);
}

/** Where the host stands its action menu for a trigger; undefined when the host draws none, so a tab's right-click opens nothing. */
export function hostActionMenuPlacement(): ((trigger: HTMLElement) => string) | undefined {
  return hostUi?.actionMenuStyles === undefined ? undefined : hostUi.placeActionMenu;
}

export function describeTerminalError(error: unknown): string {
  return hostUi === undefined ? String(error) : hostUi.describeError(error);
}

/** How long an older host without `readFailure` waits between quiet retries: the quiet window of B48. */
const OLDER_HOST_RETRY_MS = 15_000;

/** The host's B48 answer for a failed request (`attempt` counts misses in a row from 0); an older host gets a quiet retry. */
export function terminalReadFailure(error: unknown, attempt: number): PluginReadFailure {
  return hostUi?.readFailure?.(error, attempt) ?? { kind: "retry", delayMs: OLDER_HOST_RETRY_MS };
}

/** The host's touch-or-narrow layout, where the extra keys and the keyboard button show. */
export function touchLayoutMedia(): MediaQueryList | undefined {
  const query = hostUi?.breakpoints.coarseOrMobile;
  return query === undefined || typeof window === "undefined" || !("matchMedia" in window) ? undefined : window.matchMedia(query);
}

/** The shell's close mark, so the terminal panel draws the same × as the
 * built-in dialogs instead of typing the character. */
export function renderHostCloseIcon(): unknown {
  return hostUi?.renderCloseIcon?.();
}
