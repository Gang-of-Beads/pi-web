// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { Project, SessionInfo, Workspace } from "../api";
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

  it("renders four-state badges from sessionStates, with three dots only while working", async () => {
    const sessions = [session("work", { name: "streaming" }), session("done", { name: "finished" }), session("ask", { name: "waiting on me" }), session("bad", { name: "model error" })];
    const switcher = await mount({
      sessions,
      selectedWorkspace: workspace("main"),
      activeSessionIds: new Set(["work", "done", "ask", "bad"]),
      sessionStates: new Map([
        ["work", "working"],
        ["done", "idle"],
        ["ask", "asking"],
        ["bad", "error"],
      ]),
    });

    const rows = sessionRows(switcher);
    const byName = (name: string) => rows.find((row) => rowTitle(row) === name);
    expect(byName("streaming")?.querySelectorAll(".state-dot").length).toBe(3);
    expect(byName("streaming")?.querySelector(".session-state")?.getAttribute("class")).toContain("working");
    expect(byName("finished")?.querySelector(".session-state")?.getAttribute("class")).toContain("idle");
    expect(byName("waiting on me")?.querySelector(".session-state")?.getAttribute("class")).toContain("asking");
    expect(byName("model error")?.querySelector(".session-state")?.getAttribute("class")).toContain("error");
    // A working row never also shows the old single flag dot.
    expect(byName("streaming")?.querySelector(".row-flag.active")).toBeNull();
  });

  it("falls back to a working badge for active sessions the state map has not reached yet", async () => {
    const switcher = await mount({
      sessions: [session("fresh", { name: "just opened" })],
      selectedWorkspace: workspace("main"),
      activeSessionIds: new Set(["fresh"]),
      sessionStates: new Map(),
    });

    const row = sessionRows(switcher).find((candidate) => rowTitle(candidate) === "just opened");
    expect(row?.querySelectorAll(".state-dot").length).toBe(3);
    expect(row?.querySelector(".session-state")?.getAttribute("class")).toContain("working");
  });

  it("shows only the interrupted ring for a cut-off session, not a green idle dot", async () => {
    const switcher = await mount({
      sessions: [session("cut", { name: "cut off by restart" })],
      selectedWorkspace: workspace("main"),
      activeSessionIds: new Set(),
      sessionStates: new Map([["cut", "idle"]]),
      interruptedSessionIds: new Set(["cut"]),
    });

    const row = sessionRows(switcher).find((candidate) => rowTitle(candidate) === "cut off by restart");
    expect(row?.querySelector(".row-flag.interrupted")).not.toBeNull();
    // One mark in the corner: the interrupted ring replaces the idle dot.
    expect(row?.querySelector(".session-state")).toBeNull();
  });

  it("lets live work replace the interrupted ring once the run continues", async () => {
    const switcher = await mount({
      sessions: [session("resumed", { name: "resumed" })],
      selectedWorkspace: workspace("main"),
      activeSessionIds: new Set(["resumed"]),
      sessionStates: new Map([["resumed", "working"]]),
      interruptedSessionIds: new Set(["resumed"]),
    });

    const row = sessionRows(switcher).find((candidate) => rowTitle(candidate) === "resumed");
    expect(row?.querySelector(".row-flag.interrupted")).toBeNull();
    expect(row?.querySelectorAll(".state-dot").length).toBe(3);
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
  activeSessionIds?: ReadonlySet<string>;
  sessionStates?: ReadonlyMap<string, "working" | "idle" | "asking" | "error">;
  interruptedSessionIds?: ReadonlySet<string>;
  errorSessionIds?: ReadonlySet<string>;
  pinnedSessionIds?: ReadonlySet<string>;
  projects?: readonly Project[];
  onTogglePin?: (session: SessionInfo) => void;
  onRenameSession?: (session: SessionInfo, name: string) => void;
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
  if (props.activeSessionIds !== undefined) switcher.activeSessionIds = props.activeSessionIds;
  if (props.sessionStates !== undefined) switcher.sessionStates = props.sessionStates;
  if (props.interruptedSessionIds !== undefined) switcher.interruptedSessionIds = props.interruptedSessionIds;
  if (props.errorSessionIds !== undefined) switcher.errorSessionIds = props.errorSessionIds;
  if (props.pinnedSessionIds !== undefined) switcher.pinnedSessionIds = props.pinnedSessionIds;
  if (props.projects !== undefined) switcher.projects = props.projects;
  if (props.onTogglePin !== undefined) switcher.onTogglePin = props.onTogglePin;
  if (props.onRenameSession !== undefined) switcher.onRenameSession = props.onRenameSession;
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

function workspace(id: string, projectId = "project-1"): Workspace {
  return { id, projectId, label: id, path: `/repo/${id}`, isMain: id === "main", effectiveConfig: {} };
}

function project(id: string, name = id): Project {
  return { id, name, path: `/repo/${id}`, createdAt: "2026-08-01T00:00:00.000Z" };
}

function chips(switcher: QuickSwitcher): HTMLButtonElement[] {
  return [...switcher.renderRoot.querySelectorAll<HTMLButtonElement>(".chip")];
}

function menuToggle(switcher: QuickSwitcher, index = 0): HTMLButtonElement {
  const toggle = [...switcher.renderRoot.querySelectorAll<HTMLButtonElement>(".row-menu-toggle")][index];
  if (toggle === undefined) throw new Error("Expected a row menu toggle");
  return toggle;
}

function menuItems(switcher: QuickSwitcher): HTMLButtonElement[] {
  return [...switcher.renderRoot.querySelectorAll<HTMLButtonElement>(".row-menu button")];
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

describe("quick-switcher context filters", () => {
  const ws = [workspace("main", "project-a"), workspace("feat", "project-b")];
  const sessions = [session("a", { cwd: "/repo/main", name: "in main" }), session("b", { cwd: "/repo/feat", name: "in feat" })];

  it("shows every workspace's sessions until a filter is chosen", async () => {
    const switcher = await mount({ sessions, workspaces: ws, projects: [project("project-a"), project("project-b")] });
    expect(sessionRows(switcher)).toHaveLength(2);
    expect(chips(switcher)[0]?.getAttribute("aria-pressed")).toBe("true");
  });

  it("narrows to one project and widens again when the same chip is tapped", async () => {
    const switcher = await mount({ sessions, workspaces: ws, projects: [project("project-a"), project("project-b")] });
    const projectChip = chips(switcher).find((chip) => chip.textContent.trim() === "project-a");

    projectChip?.click();
    await switcher.updateComplete;
    expect(sessionRows(switcher).map(rowTitle)).toEqual(["in main"]);

    projectChip?.click();
    await switcher.updateComplete;
    expect(sessionRows(switcher)).toHaveLength(2);
  });
});

describe("quick-switcher row actions", () => {
  it("pins from the row menu and marks the row", async () => {
    const onTogglePin = vi.fn<(session: SessionInfo) => void>();
    const target = session("a", { name: "billing" });
    const switcher = await mount({ sessions: [target], onTogglePin });

    menuToggle(switcher).click();
    await switcher.updateComplete;
    const pin = menuItems(switcher).find((item) => item.textContent.includes("Pin"));
    pin?.click();

    expect(onTogglePin).toHaveBeenCalledWith(target);
  });

  it("labels the action Unpin and marks the row when already pinned", async () => {
    const switcher = await mount({ sessions: [session("a", { name: "billing" })], pinnedSessionIds: new Set(["a"]) });
    expect(switcher.renderRoot.querySelector(".pin-mark")).not.toBeNull();

    menuToggle(switcher).click();
    await switcher.updateComplete;
    expect(menuItems(switcher).some((item) => item.textContent.includes("Unpin"))).toBe(true);
  });

  it("renames inline and reports the new name once", async () => {
    const onRenameSession = vi.fn<(session: SessionInfo, name: string) => void>();
    const target = session("a", { name: "billing" });
    const switcher = await mount({ sessions: [target], onRenameSession });

    menuToggle(switcher).click();
    await switcher.updateComplete;
    menuItems(switcher).find((item) => item.textContent.includes("Rename"))?.click();
    await switcher.updateComplete;

    const input = switcher.renderRoot.querySelector<HTMLInputElement>(".rename-input");
    if (input === null) throw new Error("Expected the inline rename input");
    input.value = "invoice sync";
    input.dispatchEvent(new Event("input"));
    switcher.renderRoot.querySelector<HTMLFormElement>(".rename-row")?.dispatchEvent(new Event("submit", { cancelable: true }));
    await switcher.updateComplete;

    expect(onRenameSession).toHaveBeenCalledWith(target, "invoice sync");
  });

  it("lists an errored session above one that is merely running", async () => {
    const switcher = await mount({
      sessions: [session("running", { name: "running" }), session("stuck", { name: "stuck" })],
      activeSessionIds: new Set(["running"]),
      errorSessionIds: new Set(["stuck"]),
    });

    expect(sessionRows(switcher).map(rowTitle)).toEqual(["stuck", "running"]);
  });
});
