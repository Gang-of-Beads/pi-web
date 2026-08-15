// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo, Workspace } from "../api";
import { QuickSwitcher } from "./QuickSwitcher";

afterEach(() => {
  document.body.replaceChildren();
});

describe("quick-switcher", () => {
  it("creates a session in the selected workspace without any drill-down", async () => {
    const onCreateSession = vi.fn<() => void>();
    const onClose = vi.fn<() => void>();
    const switcher = await mount({
      sessions: [],
      selectedWorkspace: workspace("main"),
      canStartSession: true,
      onCreateSession,
      onClose,
    });

    createRow(switcher).click();

    expect(onCreateSession).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("disables creation and explains why when no workspace is selected", async () => {
    const onCreateSession = vi.fn<() => void>();
    const switcher = await mount({ sessions: [], canStartSession: false, onCreateSession });

    const row = createRow(switcher);
    expect(row.disabled).toBe(true);
    expect(row.textContent).toContain("Select a workspace first");

    row.click();
    expect(onCreateSession).not.toHaveBeenCalled();
  });

  it("opens a session straight from the flat list", async () => {
    const onOpenSession = vi.fn<(session: SessionInfo) => void>();
    const target = session("b", { name: "mobile layout" });
    const switcher = await mount({ sessions: [session("a", { name: "billing" }), target], onOpenSession });

    sessionRows(switcher).find((row) => row.textContent.includes("mobile layout"))?.click();

    expect(onOpenSession).toHaveBeenCalledWith(target);
  });

  it("filters sessions as the query is typed", async () => {
    const switcher = await mount({
      sessions: [session("a", { name: "billing refactor" }), session("b", { name: "mobile layout" })],
    });

    await type(switcher, "mobile");

    expect(sessionRows(switcher).map(rowTitle)).toEqual(["mobile layout"]);
  });

  it("opens the best match on Enter from the search field", async () => {
    const onOpenSession = vi.fn<(session: SessionInfo) => void>();
    const target = session("b", { name: "mobile layout" });
    const switcher = await mount({ sessions: [session("a", { name: "billing" }), target], onOpenSession });

    await type(switcher, "mobile");
    searchInput(switcher).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }));

    expect(onOpenSession).toHaveBeenCalledWith(target);
  });

  it("offers sibling workspaces inline and keeps the sheet open after switching", async () => {
    const onSelectWorkspace = vi.fn<(workspace: Workspace) => void>();
    const onClose = vi.fn<() => void>();
    const other = workspace("feature-login");
    const switcher = await mount({
      sessions: [],
      workspaces: [workspace("main"), other],
      selectedWorkspace: workspace("main"),
      onSelectWorkspace,
      onClose,
    });

    const rows = [...switcher.renderRoot.querySelectorAll<HTMLButtonElement>(".workspace-row")];
    expect(rows.map(rowTitle)).toEqual(["feature-login"]);

    rows[0]?.click();

    expect(onSelectWorkspace).toHaveBeenCalledWith(other);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a browse escape hatch to the full navigation panel", async () => {
    const onBrowse = vi.fn<() => void>();
    const onClose = vi.fn<() => void>();
    const switcher = await mount({ sessions: [], onBrowse, onClose });

    switcher.renderRoot.querySelector<HTMLButtonElement>("footer button")?.click();

    expect(onBrowse).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("reports an empty search instead of an empty sheet", async () => {
    const switcher = await mount({ sessions: [session("a", { name: "billing" })] });

    await type(switcher, "zzzz");

    expect(switcher.renderRoot.querySelector(".empty")?.textContent).toContain("zzzz");
  });
});

interface MountProps {
  sessions: SessionInfo[];
  workspaces?: Workspace[];
  selectedWorkspace?: Workspace;
  canStartSession?: boolean;
  onCreateSession?: () => void;
  onOpenSession?: (session: SessionInfo) => void;
  onSelectWorkspace?: (workspace: Workspace) => void;
  onBrowse?: () => void;
  onClose?: () => void;
}

async function mount(props: MountProps): Promise<QuickSwitcher> {
  const switcher = new QuickSwitcher();
  switcher.sessions = props.sessions;
  switcher.workspaces = props.workspaces ?? [];
  if (props.selectedWorkspace !== undefined) switcher.selectedWorkspace = props.selectedWorkspace;
  switcher.canStartSession = props.canStartSession ?? true;
  if (props.onCreateSession !== undefined) switcher.onCreateSession = props.onCreateSession;
  if (props.onOpenSession !== undefined) switcher.onOpenSession = props.onOpenSession;
  if (props.onSelectWorkspace !== undefined) switcher.onSelectWorkspace = props.onSelectWorkspace;
  if (props.onBrowse !== undefined) switcher.onBrowse = props.onBrowse;
  if (props.onClose !== undefined) switcher.onClose = props.onClose;
  document.body.append(switcher);
  await switcher.updateComplete;
  return switcher;
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/repo/.pi/sessions/${id}.jsonl`,
    cwd: "/repo/main",
    persisted: true,
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: 2,
    firstMessage: "",
    ...overrides,
  };
}

function workspace(id: string): Workspace {
  return { id, projectId: "project-1", label: id, path: `/repo/${id}`, isMain: id === "main", effectiveConfig: {} };
}

function searchInput(switcher: QuickSwitcher): HTMLInputElement {
  const input = switcher.renderRoot.querySelector<HTMLInputElement>("input");
  if (input === null) throw new Error("Expected the quick switcher search input");
  return input;
}

async function type(switcher: QuickSwitcher, value: string): Promise<void> {
  const input = searchInput(switcher);
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await switcher.updateComplete;
}

function createRow(switcher: QuickSwitcher): HTMLButtonElement {
  const row = switcher.renderRoot.querySelector<HTMLButtonElement>(".create-row");
  if (row === null) throw new Error("Expected the quick switcher create row");
  return row;
}

function sessionRows(switcher: QuickSwitcher): HTMLButtonElement[] {
  return [...switcher.renderRoot.querySelectorAll<HTMLButtonElement>(".session-row")];
}

function rowTitle(row: HTMLButtonElement): string {
  return row.querySelector(".row-title")?.textContent.trim() ?? "";
}
