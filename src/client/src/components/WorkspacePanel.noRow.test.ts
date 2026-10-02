// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { html } from "lit";
import { initialAppState } from "../appState";
import { noPanelTerminal } from "../plugins/terminalSessionsTestSupport";
import { stubWorkspaceFiles } from "../plugins/workspaceFilesTestSupport";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { WorkspacePanel } from "./WorkspacePanel";

/**
 * A plugin page draws no row of its own under the app bar (owner, 2026-10-01): no title row, no
 * summary, no fold, no expand key. A tool's buttons show at the top of its page; a tool without
 * buttons starts with its content.
 */
const workspace = { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true, effectiveConfig: {} };

function panelContext(): WorkspacePanelContext {
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace,
    state: { ...initialAppState(), selectedWorkspace: workspace },
    files: stubWorkspaceFiles(),
    host: { requestRender: () => undefined, workspacePanelFullscreen: () => false, setWorkspacePanelFullscreen: () => undefined },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    terminal: noPanelTerminal(),
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    terminalAutoStart: false,
    onSelectTerminal: () => undefined,
  };
}

const files: QualifiedWorkspacePanelContribution = {
  id: "files:files",
  pluginId: "files",
  localId: "files",
  title: "Files",
  summary: () => "stale",
  toolbar: () => html`<button type="button">Upload</button><button type="button">Refresh</button>`,
  render: () => html`<p class="tree">tree</p>`,
};

const goals: QualifiedWorkspacePanelContribution = {
  id: "goals:goals",
  pluginId: "goals",
  localId: "goals",
  title: "Goals",
  summary: () => "1/2 tasks",
  render: () => html`<p class="goal">goal</p>`,
};

async function mount(tool: QualifiedContributionId): Promise<WorkspacePanel> {
  const panel = new WorkspacePanel();
  panel.workspace = workspace;
  panel.tool = tool;
  panel.panels = [files, goals];
  panel.panelContext = panelContext();
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function shape(panel: WorkspacePanel): unknown {
  const root = panel.renderRoot;
  const first = [...root.children].find((element) => element.tagName !== "STYLE");
  return {
    rows: root.querySelectorAll("header, [role=heading]").length,
    first: first?.className ?? null,
    buttons: [...root.querySelectorAll(".workspace-tool-toolbar button")].map((button) => button.textContent.trim()),
    text: root.textContent.replace(/\s+/gu, " ").trim(),
  };
}

afterEach(() => { document.body.replaceChildren(); });

describe("a plugin page under the app bar", () => {
  it("shows a tool's buttons at the top of its page, with no row above them", async () => {
    expect(shape(await mount("files:files"))).toEqual({ rows: 0, first: "workspace-tool-toolbar", buttons: ["Upload", "Refresh"], text: "UploadRefresh tree" });
  });

  it("starts a tool without buttons with its content", async () => {
    expect(shape(await mount("goals:goals"))).toEqual({ rows: 0, first: "panel-content", buttons: [], text: "goal" });
  });
});
