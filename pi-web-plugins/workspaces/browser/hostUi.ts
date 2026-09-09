import type { PluginHostUi } from "@gang-of-beads/pi-web/plugin-api";
import type { CSSResultArray, CSSResultGroup } from "lit";

/**
 * What this plugin actually consumes from the host: the shell-owned styles
 * the pickers adopt and the dialog surface. Naming the subset keeps the
 * plugin's real dependencies visible and lets tests stand a host in with
 * just these faces.
 */
type WorkspacesHostUi = Pick<PluginHostUi, "surfaceStyles" | "renderDisclosureIcon" | "renderCloseIcon" | "listStyles" | "showDialog">;

/**
 * The host utilities and context actions this plugin was activated with.
 *
 * The picker elements are custom elements, so they are registered when the
 * module is first imported - before any call could hand the host in. The
 * plugin therefore records what the host gave it and imports the elements
 * afterwards, which is why this holder exists rather than parameters.
 */

let hostUi: WorkspacesHostUi | undefined;

export function rememberWorkspacesHost(ui: WorkspacesHostUi | undefined): void {
  hostUi = ui;
}

/**
 * The shell's list and interactive-surface styles, handed through the host
 * seam rather than copied: one producer per decision, so a shell-side retune
 * reaches the pickers without a plugin-side edit. They are adopted per
 * element instance in `createRenderRoot` - `static styles` freezes at module
 * load, which runs before the host is remembered - and absence of a host
 * (raw element mounts in tests) means no styles, not a stale copy.
 */
export function adoptWorkspacesHostStyles(root: ShadowRoot): void {
  const host = workspacesHostUi();
  if (host === undefined) return;
  const sheets = cssResultSheets([host.surfaceStyles, host.listStyles]);
  if (sheets.length === 0) return;
  root.adoptedStyleSheets = [...root.adoptedStyleSheets, ...sheets];
}

function isCssResultGroupArray(group: CSSResultGroup): group is CSSResultArray {
  return Array.isArray(group);
}

function cssResultSheets(groups: CSSResultGroup[]): CSSStyleSheet[] {
  const sheets: CSSStyleSheet[] = [];
  const collect = (group: CSSResultGroup): void => {
    if (!isCssResultGroupArray(group) && "cssText" in group) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(group.cssText);
      sheets.push(sheet);
      return;
    }
    if (isCssResultGroupArray(group)) group.forEach(collect);
  };
  groups.forEach(collect);
  return sheets;
}

export function workspacesHostUi(): WorkspacesHostUi | undefined {
  return hostUi;
}

/**
 * The shell's disclosure chevron, so a contributed list spells "this section
 * opens" the way the built-in lists and the chrome spell it.
 */
export function renderHostDisclosureIcon(collapsed: boolean): unknown {
  const host = workspacesHostUi();
  return host?.renderDisclosureIcon?.(collapsed);
}

/** The shell's close mark, so a contributed dialog draws the same × as the
 * built-in ones instead of typing the character. */
export function renderHostCloseIcon(): unknown {
  return workspacesHostUi()?.renderCloseIcon?.();
}
