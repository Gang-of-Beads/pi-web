// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { noTerminalSessions } from "../plugins/terminalSessionsTestSupport";
import { html } from "lit";
import { initialAppState } from "../appState";
import type { WorkspacePanelContext, QualifiedWorkspacePanelContribution } from "../plugins/types";
import { WorkspacePanel } from "./WorkspacePanel";

const workspace = { id: "workspace-1", projectId: "project-1", path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
const panels: QualifiedWorkspacePanelContribution[] = ["files", "terminal", "tasks"].map((name, index) => ({
  id: `core:workspace.${name}`,
  pluginId: "core",
  localId: `workspace.${name}`,
  title: `${name[0]?.toUpperCase() ?? ""}${name.slice(1)}`,
  order: index,
  render: () => html`<p>${name}</p>`,
}));

afterEach(() => {
  document.body.replaceChildren();
});

describe("WorkspacePanel fullscreen control", () => {
  it("offers the same reversible control for every workspace tool", async () => {
    let expanded = false;
    const panel = new WorkspacePanel();
    const setWorkspacePanelFullscreen = vi.fn((next: boolean) => {
      expanded = next;
      panel.requestUpdate();
    });
    panel.workspace = workspace;
    panel.tool = "core:workspace.files";
    panel.panels = panels;
    panel.panelContext = panelContext(() => expanded, setWorkspacePanelFullscreen);
    document.body.append(panel);
    await panel.updateComplete;

    fullscreenButton(panel, "Expand panel").click();
    await panel.updateComplete;
    expect(setWorkspacePanelFullscreen).toHaveBeenLastCalledWith(true);
    expect(fullscreenButton(panel, "Exit expanded view").getAttribute("aria-pressed")).toBe("true");

    panel.tool = "core:workspace.terminal";
    await panel.updateComplete;
    expect(fullscreenButton(panel, "Exit expanded view")).toBeDefined();

    fullscreenButton(panel, "Exit expanded view").click();
    await panel.updateComplete;
    expect(setWorkspacePanelFullscreen).toHaveBeenLastCalledWith(false);
    expect(fullscreenButton(panel, "Expand panel").getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the shared control out of the mobile workspace header", () => {
    expect(String(WorkspacePanel.styles)).toContain("@media (max-width: 1180px) { header { display: none; } }");
  });
});

function panelContext(
  workspacePanelFullscreen: () => boolean,
  setWorkspacePanelFullscreen: (expanded: boolean) => void,
): WorkspacePanelContext {
  const reject = () => Promise.reject(new Error("not used"));
  return {
    machine: { id: "local", name: "Local", kind: "local" },
    workspace,
    state: { ...initialAppState(), selectedWorkspace: workspace },
    files: { readFile: reject, listFiles: reject, writeFile: reject, deleteFile: reject, moveFile: reject },
    host: { requestRender: () => undefined, workspacePanelFullscreen, setWorkspacePanelFullscreen },
    prompt: { insertText: () => undefined, getText: () => "", getSelection: () => null },
    terminal: { open: () => undefined, runCommand: reject, sessions: noTerminalSessions() },
    fileTree: [],
    expandedDirs: {},
    selectedFilePath: undefined,
    selectedFileContent: undefined,
    selectedFileLoadError: undefined,
    fileTreeStale: false,
    fileTreeFailed: undefined,
    activeTerminalCount: 0,
    selectedTerminalId: undefined,
    terminalAutoStart: false,
    workspaceUploadDefaultFolder: "",
    onRefreshFiles: () => undefined,
    onExpandDir: () => undefined,
    onSelectFile: () => undefined,
    onStartWorkspaceUpload: () => undefined,
    onCancelWorkspaceUpload: () => undefined,
    onClearWorkspaceUpload: () => undefined,
    onSelectTerminal: () => undefined,
  };
}

function fullscreenButton(panel: WorkspacePanel, label: string): HTMLButtonElement {
  const button = [...(panel.shadowRoot?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent.trim() === label);
  if (!(button instanceof HTMLButtonElement)) throw new Error(`Missing fullscreen button: ${label}`);
  return button;
}
