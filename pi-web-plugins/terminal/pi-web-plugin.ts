import { html, type TemplateResult } from "lit";
import type { PiWebPlugin, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { rememberTerminalHostUi } from "./hostUi.js";
import { defineTerminalPanel } from "./defineTerminalPanel.js";

/**
 * Terminals as a plugin.
 *
 * The pty capability stays with the host, which owns the daemon that spawns
 * it; this plugin draws the panel and works entirely through the capability it
 * is handed.
 *
 * The panel module is imported for its side effect - defining the element -
 * from `activate`, after the host's utilities are recorded, because a custom
 * element reads its styles when its module is first evaluated. A lazy import
 * from the render function looked equivalent and was not: the bundled entry
 * kept it as a separate chunk that never ran, so the element was never defined
 * and the panel rendered as an empty tag.
 */

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Terminal",
  activate: (context) => {
    rememberTerminalHostUi(context.ui);
    defineTerminalPanel();
    return {
      contributions: {
        workspacePanels: [{
          id: "terminal",
          title: "Terminal",
          icon: context.svg`<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 6h16v12H4z"/><path d="m8 10 2 2-2 2"/><path d="M13 14h3"/></svg>`,
          order: 30,
          routeAliases: ["terminal", "core:workspace.terminal"],
          badge: (panel: WorkspacePanelContext) => panel.terminal.activeCount > 0 ? panel.terminal.activeCount : undefined,
          render: renderTerminalPanel,
        }],
      },
    };
  },
};

function renderTerminalPanel(context: WorkspacePanelContext): TemplateResult {
  return html`<terminal-panel
    .workspace=${context.workspace}
    .machineId=${context.machine.id}
    .sessions=${context.terminal.sessions}
    .selectedTerminalId=${context.terminal.selectedId}
    .autoStart=${context.terminal.autoStart}
    .expanded=${context.host.workspacePanelFullscreen()}
    .onSelectTerminal=${context.terminal.select}
  ></terminal-panel>`;
}

export default plugin;
