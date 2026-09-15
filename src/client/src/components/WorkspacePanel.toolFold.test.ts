// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { html } from "lit";
import { initialAppState } from "../appState";
import { noPanelTerminal } from "../plugins/terminalSessionsTestSupport";
import { stubWorkspaceFiles } from "../plugins/workspaceFilesTestSupport";
import type { QualifiedContributionId, QualifiedWorkspacePanelContribution, WorkspacePanelContext } from "../plugins/types";
import { createWorkspaceToolFoldStore } from "../workspaceToolFold";
import { WorkspacePanel } from "./WorkspacePanel";

/**
 * The host owns the tool header: title and summary in one row, the tool's
 * controls behind a fold remembered per tool, collapsed by default. A tool
 * without controls gets no fold button, so nothing invites a tap that does
 * nothing.
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

const git: QualifiedWorkspacePanelContribution = {
  id: "git:workspace.git",
  pluginId: "git",
  localId: "workspace.git",
  title: "Git",
  summary: () => "main · ↑1 ↓0",
  toolbar: () => html`<button type="button" class="tool-refresh">Refresh</button>`,
  render: () => html`<p>No changes.</p>`,
};

const info: QualifiedWorkspacePanelContribution = {
  id: "info:workspace.info",
  pluginId: "info",
  localId: "workspace.info",
  title: "Info",
  render: () => html`<p>about</p>`,
};

async function mount(tool: QualifiedContributionId, backing = new Map<string, string>()): Promise<{ panel: WorkspacePanel; backing: Map<string, string> }> {
  const panel = new WorkspacePanel();
  panel.workspace = workspace;
  panel.tool = tool;
  panel.panels = [git, info];
  panel.panelContext = panelContext();
  panel.foldStore = createWorkspaceToolFoldStore({ getItem: (key) => backing.get(key) ?? null, setItem: (key, value) => { backing.set(key, value); } });
  document.body.append(panel);
  await panel.updateComplete;
  return { panel, backing };
}

function foldButton(panel: WorkspacePanel): HTMLButtonElement | null {
  return panel.renderRoot.querySelector<HTMLButtonElement>(".workspace-tool-fold");
}

afterEach(() => { document.body.replaceChildren(); });

describe("the workspace tool header", () => {
  it("names the tool and its summary in one row and starts with the controls folded away", async () => {
    const { panel } = await mount("git:workspace.git");

    expect(panel.renderRoot.querySelector(".panel-header-title")?.textContent.replace(/\s+/gu, " ").trim()).toBe("Git · main · ↑1 ↓0");
    expect(foldButton(panel)?.getAttribute("aria-expanded")).toBe("false");
    expect(panel.renderRoot.querySelector(".workspace-tool-toolbar")).toBeNull();
    expect(panel.renderRoot.querySelector(".panel-content")?.textContent).toContain("No changes.");
  });

  it("opens the fold on tap, shows the tool's controls, and remembers it for that tool only", async () => {
    const { panel, backing } = await mount("git:workspace.git");

    foldButton(panel)?.click();
    await panel.updateComplete;
    expect(foldButton(panel)?.getAttribute("aria-expanded")).toBe("true");
    expect(panel.renderRoot.querySelector(".workspace-tool-toolbar .tool-refresh")).not.toBeNull();
    expect(backing.get("pi-web.workspace-tool-fold:git:workspace.git")).toBe("open");

    const again = await mount("git:workspace.git", backing);
    expect(foldButton(again.panel)?.getAttribute("aria-expanded")).toBe("true");
  });

  it("draws no fold button for a tool without controls", async () => {
    const { panel } = await mount("info:workspace.info");

    expect(panel.renderRoot.querySelector(".panel-header-title")?.textContent.trim()).toBe("Info");
    expect(foldButton(panel)).toBeNull();
  });
});
