import { html, type TemplateResult } from "lit";
import type { PiWebPlugin, WorkspacePanelContext } from "@gang-of-beads/pi-web/plugin-api";
import { rememberTerminalHostUi } from "./hostUi.js";

/**
 * Terminals as a plugin.
 *
 * The pty capability stays with the host, which owns the daemon that spawns
 * it; this plugin draws the panel and works entirely through the capability it
 * is handed. The panel module is imported only when the panel is first
 * rendered, and only after the host's utilities have been recorded, because a
 * custom element reads its styles when its module is first evaluated.
 */

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Terminal",
  activate: (context) => {
    rememberTerminalHostUi(context.ui);
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
  void import("./TerminalPanel.js");
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
