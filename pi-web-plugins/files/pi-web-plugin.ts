import { html, svg, type TemplateResult } from "lit";
import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { rememberFilesHostUi } from "./hostUi";
import { FilesPanelLink } from "./filesPanelElement";

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
    const link = new FilesPanelLink();
    context.on?.("session-activity-settled", () => { link.markStale(); });

    return {
      contributions: {
        workspacePanels: [
          {
            id: "files",
            title: "Files",
            icon: FOLDER_ICON,
            order: 10,
            routeAliases: ["files", "core:workspace.files"],
            toolbar: () => html`
              <style .textContent=${FILES_TOOLBAR_STYLES}></style>
              <button type="button" @click=${() => { link.requestUpload(); }}>Upload</button>
              <button type="button" @click=${() => { link.invalidate(); }}>Refresh</button>
              ${link.showsStale() ? html`<span class="files-toolbar-status">out of date</span>` : null}
            `,
            render: (panelContext): TemplateResult => html`<pi-files-panel .context=${panelContext} .link=${link}></pi-files-panel>`,
            onInvalidate: () => { link.invalidate(); },
          },
        ],
      },
    };
  },
};

/**
 * Files says its own status at the end of its toolbar, beside the Refresh that
 * clears it: the host draws no title row any more (owner, 2026-10-01), and the
 * page owns what it shows (owner, 2026-10-02).
 */
const FILES_TOOLBAR_STYLES = `
  .files-toolbar-status { margin-left: auto; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-xs); }
`;

export default filesPlugin;
