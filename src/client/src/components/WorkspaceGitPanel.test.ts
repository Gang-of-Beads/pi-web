import type { TemplateResult } from "lit";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitStatusFile, GitStatusResponse } from "../api";
import { initialAppState } from "../appState";
import { GIT_FILE_VIEW_STORAGE_KEY } from "../gitFileViewPreference";
import type { WorkspacePanelContext } from "../plugins/types";
// Genuine Lit event-wiring extraction (view-toggle, expand/collapse-all, and
// row clicks) routes through the shared, type-guarded template-inspection
// escape hatch; see ../templateInspection.testSupport for the proportionality
// rationale. Vitest runs in the node environment (no DOM), so the few
// rendered-output assertions (toolbar order, badge, state labels) read the
// returned TemplateResult through the shared templateText/templateStrings/
// templateValues primitives, anchored to stable user-facing labels and markup
// — kept narrow per the testing guide.
import {
  findOptionalTemplateClickHandlerForText,
  isTemplateResult,
  templateClickHandlerForText,
  templateStrings,
  templateText,
  templateValues,
} from "../templateInspection.testSupport";
import { WorkspaceGitPanel } from "./WorkspaceGitPanel";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workspace-git-panel view toggle", () => {
  it("switches between list and tree rendering and persists the choice", () => {
    const { panel, storage } = newGitPanel();
    const onSelectDiff = vi.fn<WorkspacePanelContext["onSelectDiff"]>();
    panel.context = workspacePanelContext({ gitStatus: gitStatus({ files: [gitFile("src/main.ts")] }), onSelectDiff });

    // List view (the default) renders full-path rows that load their diff.
    templateClickHandlerForText(panel.render(), "src/main.ts")(new Event("click"));
    expect(onSelectDiff).toHaveBeenCalledWith("src/main.ts");

    templateClickHandlerForText(panel.render(), "Tree")(new Event("click"));
    expect(storage.value(GIT_FILE_VIEW_STORAGE_KEY)).toBe("tree");

    // Tree view nests the file under its (collapsed) directory instead.
    let rendered = panel.render();
    expect(findOptionalTemplateClickHandlerForText(rendered, "src/main.ts")).toBeUndefined();
    templateClickHandlerForText(rendered, "src");

    templateClickHandlerForText(panel.render(), "List")(new Event("click"));
    expect(storage.value(GIT_FILE_VIEW_STORAGE_KEY)).toBe("list");
    rendered = panel.render();
    expect(findOptionalTemplateClickHandlerForText(rendered, "src/main.ts")).toBeDefined();
  });

  it("restores the persisted view on construction", () => {
    const { panel } = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" });
    panel.context = workspacePanelContext({ gitStatus: gitStatus({ files: [gitFile("src/main.ts")] }) });

    const rendered = panel.render();
    expect(findOptionalTemplateClickHandlerForText(rendered, "src/main.ts")).toBeUndefined();

    templateClickHandlerForText(rendered, "src")(new Event("click"));
    expect(findOptionalTemplateClickHandlerForText(panel.render(), "main.ts")).toBeDefined();
  });
});

describe("workspace-git-panel toolbar order", () => {
  it("renders expand/collapse-all before the view toggle, which stays anchored next to Refresh", () => {
    // Pins the UX fix: the right-anchored view toggle and Refresh button must
    // not move when the expand/collapse-all control appears or disappears.
    const listPanel = newGitPanel().panel;
    listPanel.context = workspacePanelContext({ gitStatus: gitStatus({ files: [gitFile("one.ts")] }) });
    const withoutExpandAll = toolbarSlots(listPanel.render());
    expect(withoutExpandAll.expandCollapseSlot).toBeNull();

    const treePanel = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" }).panel;
    treePanel.context = workspacePanelContext({ gitStatus: treeStatus() });
    const withExpandAll = toolbarSlots(treePanel.render());
    const expandCollapse = withExpandAll.expandCollapseSlot;
    if (!isTemplateResult(expandCollapse)) throw new Error("expand/collapse-all control missing in tree view");
    expect(templateText(expandCollapse)).toContain("Expand all");

    // The toggle occupies the same template slot whether or not the
    // expand/collapse-all control renders in the slot before it.
    expect(withExpandAll.toggleIndex).toBe(withoutExpandAll.toggleIndex);
  });
});

describe("workspace-git-panel expand/collapse all", () => {
  it("expands and collapses every directory, flipping its label", () => {
    const { panel } = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" });
    panel.context = workspacePanelContext({ gitStatus: treeStatus() });

    expect(findOptionalTemplateClickHandlerForText(panel.render(), "b.ts")).toBeUndefined();

    templateClickHandlerForText(panel.render(), "Expand all")(new Event("click"));
    let rendered = panel.render();
    expect(findOptionalTemplateClickHandlerForText(rendered, "Expand all")).toBeUndefined();
    templateClickHandlerForText(rendered, "Collapse all");
    templateClickHandlerForText(rendered, "a.ts");
    templateClickHandlerForText(rendered, "b.ts");

    templateClickHandlerForText(panel.render(), "Collapse all")(new Event("click"));
    rendered = panel.render();
    templateClickHandlerForText(rendered, "Expand all");
    expect(findOptionalTemplateClickHandlerForText(rendered, "b.ts")).toBeUndefined();
  });

  it("keeps the Expand all label while expansion is partial", () => {
    const { panel } = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" });
    panel.context = workspacePanelContext({ gitStatus: treeStatus() });

    templateClickHandlerForText(panel.render(), "src")(new Event("click"));

    const rendered = panel.render();
    templateClickHandlerForText(rendered, "Expand all");
    templateClickHandlerForText(rendered, "a.ts");
    expect(findOptionalTemplateClickHandlerForText(rendered, "b.ts")).toBeUndefined();
  });

  it("expands and collapses submodule groups in list view", () => {
    const { panel } = newGitPanel();
    panel.context = workspacePanelContext({ gitStatus: submoduleStatus() });

    expect(findOptionalTemplateClickHandlerForText(panel.render(), "abc1234 → def5678")).toBeUndefined();

    templateClickHandlerForText(panel.render(), "Expand all")(new Event("click"));
    let rendered = panel.render();
    templateClickHandlerForText(rendered, "abc1234 → def5678");
    templateClickHandlerForText(rendered, "lib.ts");
    templateClickHandlerForText(rendered, "Collapse all");

    templateClickHandlerForText(panel.render(), "Collapse all")(new Event("click"));
    rendered = panel.render();
    expect(findOptionalTemplateClickHandlerForText(rendered, "abc1234 → def5678")).toBeUndefined();
    expect(findOptionalTemplateClickHandlerForText(rendered, "lib.ts")).toBeUndefined();
  });
});

describe("workspace-git-panel rows", () => {
  it("toggles a directory's children when its row is clicked", () => {
    const { panel } = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" });
    panel.context = workspacePanelContext({ gitStatus: treeStatus() });

    templateClickHandlerForText(panel.render(), "src")(new Event("click"));
    expect(findOptionalTemplateClickHandlerForText(panel.render(), "a.ts")).toBeDefined();

    templateClickHandlerForText(panel.render(), "src")(new Event("click"));
    expect(findOptionalTemplateClickHandlerForText(panel.render(), "a.ts")).toBeUndefined();
  });

  it("renders submodule groups with a basename header and badge, and pointer rows when expanded", () => {
    const { panel } = newGitPanel();
    const onSelectDiff = vi.fn<WorkspacePanelContext["onSelectDiff"]>();
    panel.context = workspacePanelContext({ gitStatus: submoduleStatus(), onSelectDiff });

    // Collapsed: only the basename header (with its submodule badge) shows.
    const collapsed = panel.render();
    const headerText = rowTextFor(collapsed, "harl");
    expect(headerText).toContain("harl");
    expect(headerText).toContain("submodule");
    expect(findOptionalTemplateClickHandlerForText(collapsed, "abc1234 → def5678")).toBeUndefined();

    templateClickHandlerForText(collapsed, "harl")(new Event("click"));

    // Expanded: the <old> → <new> pointer row and inner files select diffs.
    const rendered = panel.render();
    templateClickHandlerForText(rendered, "abc1234 → def5678")(new Event("click"));
    expect(onSelectDiff).toHaveBeenCalledWith("vendor/harl");
    templateClickHandlerForText(rendered, "lib.ts")(new Event("click"));
    expect(onSelectDiff).toHaveBeenCalledWith("vendor/harl/lib.ts");
  });

  it("renders M/A/D/U state labels for changed files", () => {
    const { panel } = newGitPanel();
    panel.context = workspacePanelContext({
      gitStatus: gitStatus({
        files: [
          gitFile("m.ts", { index: "unmodified", workingTree: "modified" }),
          gitFile("a.ts", { index: "added", workingTree: "unmodified" }),
          gitFile("d.ts", { index: "unmodified", workingTree: "deleted" }),
          gitFile("u.ts", { index: "unmodified", workingTree: "untracked" }),
        ],
      }),
    });

    const rendered = panel.render();
    expect(rowTextFor(rendered, "m.ts")).toContain("<span>M</span>");
    expect(rowTextFor(rendered, "a.ts")).toContain("<span>A</span>");
    expect(rowTextFor(rendered, "d.ts")).toContain("<span>D</span>");
    expect(rowTextFor(rendered, "u.ts")).toContain("<span>U</span>");
  });
});

describe("workspace-git-panel context reset", () => {
  it("resets expansion state when the workspace context key changes", () => {
    const { panel } = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" });
    const context = workspacePanelContext({ gitStatus: treeStatus() });
    panel.context = context;
    templateClickHandlerForText(panel.render(), "src")(new Event("click"));
    expect(findOptionalTemplateClickHandlerForText(panel.render(), "a.ts")).toBeDefined();

    const switched = workspacePanelContext({
      gitStatus: treeStatus(),
      workspace: { id: "workspace-2", projectId: "project-1", path: "/tmp/project-2", label: "other", isMain: false, isGitRepo: true, isGitWorktree: false },
    });
    panel.context = switched;
    callPanelWillUpdate(panel, context);

    const rendered = panel.render();
    templateClickHandlerForText(rendered, "Expand all");
    expect(findOptionalTemplateClickHandlerForText(rendered, "a.ts")).toBeUndefined();
  });

  it("keeps expansion state across disconnect/reconnect with the same context key", () => {
    const { panel } = newGitPanel({ [GIT_FILE_VIEW_STORAGE_KEY]: "tree" });
    const context = workspacePanelContext({ gitStatus: treeStatus() });
    panel.context = context;
    templateClickHandlerForText(panel.render(), "src")(new Event("click"));

    panel.context = undefined;
    callPanelWillUpdate(panel, context);
    expect(templateText(panel.render())).toContain("Git unavailable.");

    const reconnected = workspacePanelContext({ gitStatus: treeStatus() });
    panel.context = reconnected;
    callPanelWillUpdate(panel, undefined);
    expect(findOptionalTemplateClickHandlerForText(panel.render(), "a.ts")).toBeDefined();

    // A fresh context object with the same key (defined → defined) also keeps state.
    const sameKey = workspacePanelContext({ gitStatus: treeStatus() });
    panel.context = sameKey;
    callPanelWillUpdate(panel, reconnected);
    expect(findOptionalTemplateClickHandlerForText(panel.render(), "a.ts")).toBeDefined();
  });
});

function newGitPanel(storageValues: Record<string, string> = {}): { panel: WorkspaceGitPanel; storage: FakeStorage } {
  const storage = new FakeStorage(storageValues);
  vi.stubGlobal("window", { localStorage: storage });
  return { panel: new WorkspaceGitPanel(), storage };
}

/**
 * Structural pin for the toolbar layout contract: the expand/collapse-all
 * slot precedes the view-toggle slot inside `.toolbar-actions`, and the
 * toggle is always immediately followed by the Refresh button — so the
 * right-anchored controls never move when expand/collapse-all appears.
 */
function toolbarSlots(rendered: TemplateResult): { expandCollapseSlot: unknown; toggleIndex: number } {
  const strings = templateStrings(rendered);
  const values = templateValues(rendered);
  const actionsIndex = strings.findIndex((chunk) => chunk.includes("toolbar-actions"));
  if (actionsIndex < 0) throw new Error("toolbar-actions markup missing from the rendered panel");
  const toggleIndex = actionsIndex + 1;
  const toggle = values[toggleIndex];
  if (!isTemplateResult(toggle) || !templateStrings(toggle).some((chunk) => chunk.includes("view-toggle"))) {
    throw new Error("view toggle is not the control immediately after the expand/collapse-all slot");
  }
  const refreshOpenChunk = strings[toggleIndex + 1] ?? "";
  const refreshLabelChunk = strings[toggleIndex + 2] ?? "";
  if (!refreshOpenChunk.includes("<button") || !refreshLabelChunk.includes(">Refresh</button>")) {
    throw new Error("Refresh button does not immediately follow the view toggle");
  }
  return { expandCollapseSlot: values[actionsIndex], toggleIndex };
}

/** Flattened rendered text of the deepest template containing `anchor`. */
function rowTextFor(rendered: TemplateResult, anchor: string): string {
  const text = findDeepestTemplateText(rendered, anchor);
  if (text === undefined) throw new Error(`Expected a rendered row containing ${anchor}`);
  return text;
}

function findDeepestTemplateText(value: unknown, anchor: string): string | undefined {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDeepestTemplateText(item, anchor);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isTemplateResult(value)) return undefined;
  for (const item of templateValues(value)) {
    const found = findDeepestTemplateText(item, anchor);
    if (found !== undefined) return found;
  }
  const text = templateText(value);
  return text.includes(anchor) ? text : undefined;
}

// Protected lifecycle methods are invoked through Reflect, matching the
// SettingsSessiondPanel.test.ts precedent.
function callPanelWillUpdate(panel: WorkspaceGitPanel, previous: WorkspacePanelContext | undefined): unknown {
  const method: unknown = Reflect.get(panel, "willUpdate");
  if (typeof method !== "function") throw new Error("WorkspaceGitPanel.willUpdate is not callable");
  return Reflect.apply(method, panel, [new Map([["context", previous]])]);
}

function treeStatus(): GitStatusResponse {
  return gitStatus({
    files: [
      gitFile("src/a.ts"),
      gitFile("src/nested/b.ts"),
      gitFile("README.md"),
    ],
  });
}

function submoduleStatus(): GitStatusResponse {
  return gitStatus({
    submodules: ["vendor/harl"],
    files: [
      gitFile("vendor/harl", { submoduleFromCommit: "abc1234", submoduleToCommit: "def5678" }),
      gitFile("vendor/harl/lib.ts"),
    ],
  });
}

function gitFile(path: string, patch: Partial<GitStatusFile> = {}): GitStatusFile {
  return { path, index: "unmodified", workingTree: "modified", ...patch };
}

function gitStatus(patch: Partial<GitStatusResponse> = {}): GitStatusResponse {
  return {
    isGitRepo: true,
    hash: "hash-1",
    branch: "main",
    files: [],
    submodules: [],
    ...patch,
  };
}

class FakeStorage {
  private readonly values = new Map<string, string>();

  constructor(initial: Record<string, string> = {}) {
    for (const [key, value] of Object.entries(initial)) this.values.set(key, value);
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  value(key: string): string | undefined {
    return this.values.get(key);
  }
}

function workspacePanelContext(patch: Partial<WorkspacePanelContext> = {}): WorkspacePanelContext {
  const workspace = patch.workspace ?? { id: "workspace-1", projectId: "project-1", path: "/tmp/project", label: "main", isMain: true, isGitRepo: true, isGitWorktree: false };
  return {
    machine: patch.machine ?? { id: "local", name: "Local", kind: "local" },
    workspace,
    state: patch.state ?? { ...initialAppState(), workspaceUploadBatches: {} },
    files: patch.files ?? {
      readFile: vi.fn<WorkspacePanelContext["files"]["readFile"]>(() => Promise.reject(new Error("not implemented"))),
      writeFile: vi.fn<WorkspacePanelContext["files"]["writeFile"]>(() => Promise.reject(new Error("not implemented"))),
      deleteFile: vi.fn<WorkspacePanelContext["files"]["deleteFile"]>(() => Promise.reject(new Error("not implemented"))),
      moveFile: vi.fn<WorkspacePanelContext["files"]["moveFile"]>(() => Promise.reject(new Error("not implemented"))),
    },
    prompt: patch.prompt ?? { insertText: vi.fn<WorkspacePanelContext["prompt"]["insertText"]>(), getText: vi.fn<WorkspacePanelContext["prompt"]["getText"]>(() => ""), getSelection: vi.fn<WorkspacePanelContext["prompt"]["getSelection"]>(() => null) },
    terminal: patch.terminal ?? { open: vi.fn<WorkspacePanelContext["terminal"]["open"]>(), runCommand: vi.fn<WorkspacePanelContext["terminal"]["runCommand"]>(() => Promise.reject(new Error("not implemented"))) },
    host: patch.host ?? { requestRender: vi.fn<WorkspacePanelContext["host"]["requestRender"]>() },
    fileTree: patch.fileTree ?? [],
    expandedDirs: patch.expandedDirs ?? {},
    selectedFilePath: patch.selectedFilePath,
    selectedFileContent: patch.selectedFileContent,
    fileTreeStale: patch.fileTreeStale ?? false,
    gitStatus: patch.gitStatus,
    selectedDiffPath: patch.selectedDiffPath,
    selectedDiff: patch.selectedDiff,
    selectedStagedDiff: patch.selectedStagedDiff,
    gitStale: patch.gitStale ?? false,
    activeTerminalCount: patch.activeTerminalCount ?? 0,
    selectedTerminalId: patch.selectedTerminalId,
    terminalAutoStart: patch.terminalAutoStart ?? false,
    workspaceUploadDefaultFolder: patch.workspaceUploadDefaultFolder ?? ".pi-web/uploads",
    onRefreshFiles: patch.onRefreshFiles ?? vi.fn<WorkspacePanelContext["onRefreshFiles"]>(),
    onExpandDir: patch.onExpandDir ?? vi.fn<WorkspacePanelContext["onExpandDir"]>(),
    onSelectFile: patch.onSelectFile ?? vi.fn<WorkspacePanelContext["onSelectFile"]>(),
    onStartWorkspaceUpload: patch.onStartWorkspaceUpload ?? vi.fn<WorkspacePanelContext["onStartWorkspaceUpload"]>(() => undefined),
    onCancelWorkspaceUpload: patch.onCancelWorkspaceUpload ?? vi.fn<WorkspacePanelContext["onCancelWorkspaceUpload"]>(),
    onClearWorkspaceUpload: patch.onClearWorkspaceUpload ?? vi.fn<WorkspacePanelContext["onClearWorkspaceUpload"]>(),
    onRefreshGit: patch.onRefreshGit ?? vi.fn<WorkspacePanelContext["onRefreshGit"]>(),
    onSelectDiff: patch.onSelectDiff ?? vi.fn<WorkspacePanelContext["onSelectDiff"]>(),
    onSelectTerminal: patch.onSelectTerminal ?? vi.fn<WorkspacePanelContext["onSelectTerminal"]>(),
  };
}
