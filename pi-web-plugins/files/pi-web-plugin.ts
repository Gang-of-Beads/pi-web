import { html, svg, type TemplateResult } from "lit";
import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { rememberFilesHostUi } from "./hostUi";
import { invalidateFilesPanel, markFilesPanelStale } from "./filesPanelElement";
import "./filesPanelElement";

const FOLDER_ICON = svg`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1.5 3.5A1.5 1.5 0 0 1 3 2h3.2c.4 0 .8.16 1.06.44L8.5 3.7h4.5A1.5 1.5 0 0 1 14.5 5.2v7.3a1.5 1.5 0 0 1-1.5 1.5H3a1.5 1.5 0 0 1-1.5-1.5Z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>`;

/**
 * The workspace files experience as a plugin: tree, viewer, uploads, and the
 * deep-link namespaces. The host keeps only the file endpoints and the seam.
 */
const filesPlugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Workspace files",
  activate: (context) => {
    rememberFilesHostUi(context.ui);
    context.on?.("session-activity-settled", () => { markFilesPanelStale(); });

    return {
      contributions: {
        workspacePanels: [
          {
            id: "files",
            title: "Files",
            icon: FOLDER_ICON,
            order: 10,
            routeAliases: ["files", "core:workspace.files"],
            render: (panelContext): TemplateResult => html`<pi-files-panel .context=${panelContext}></pi-files-panel>`,
            onInvalidate: () => { invalidateFilesPanel(); },
          },
        ],
      },
    };
  },
};

export default filesPlugin;
