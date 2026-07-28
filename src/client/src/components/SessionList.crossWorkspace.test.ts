// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../api";
import type { ParentSessionLocation } from "../parentSessionLocation";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

const workspaceLocation: ParentSessionLocation = {
  kind: "workspace",
  label: "feature/parent-links",
  projectId: "project-1",
  workspaceId: "workspace-feature",
  sessionId: "parent-id",
  cwd: "/srv/dev/pi-web-feature",
};

describe("orphan child row indicator", () => {
  it("marks a session whose parent is missing as a child rather than a root row", async () => {
    const list = await renderList({ sessions: [orphan()], parentLocation: () => workspaceLocation });

    const marker = row(list).querySelector(".tree-marker.orphan-marker");
    // Same glyph as an ordinary child: the left marker answers "is this a child",
    // not "where is the parent".
    expect(marker?.textContent).toBe("↳");
    expect(marker?.getAttribute("aria-label")).toBe("parent in feature/parent-links");
    expect(marker?.getAttribute("title")).toBe("Parent session is in feature/parent-links (/srv/dev/pi-web-feature)");
  });

  it("uses the same child glyph for orphan and nested children, distinguished only by styling", async () => {
    const parent = session("parent");
    const list = await renderList({
      sessions: [parent, session("nested", { parentSessionPath: parent.path }), orphan()],
      parentLocation: () => workspaceLocation,
    });

    const markers = [...list.shadowRoot?.querySelectorAll(".tree-marker") ?? []];
    expect(markers.map((marker) => marker.textContent)).toEqual(["↳", "↳"]);
    expect(markers.filter((marker) => marker.classList.contains("orphan-marker"))).toHaveLength(1);
  });

  it("states the parent's whereabouts exactly once, on the meta line", async () => {
    const list = await renderList({ sessions: [orphan()], parentLocation: () => workspaceLocation });

    // The badge used to repeat what the meta line already says; only one
    // statement of parent whereabouts should survive.
    expect(row(list).querySelectorAll(".row-badges")).toHaveLength(0);
    const parentMentions = [...row(list).querySelectorAll("*")]
      .filter((element) => element.children.length === 0 && element.textContent.includes("parent"));
    expect(parentMentions).toHaveLength(1);
  });

  it("states where the parent lives at the start of the meta line", async () => {
    const list = await renderList({ sessions: [orphan()], parentLocation: () => workspaceLocation });

    expect(row(list).querySelector("small")?.textContent).toBe("parent in feature/parent-links · 3 messages");
  });

  it("falls back to the generic wording when the parent location is unknown", async () => {
    const list = await renderList({ sessions: [orphan()], parentLocation: () => ({ kind: "unknown" }) });

    expect(row(list).querySelector("small")?.textContent).toBe("parent unavailable · 3 messages");
    expect(row(list).querySelector(".tree-marker.orphan-marker")?.getAttribute("aria-label")).toBe("parent unavailable");
  });

  it("adds no orphan marker or parent meta to an ordinary root session", async () => {
    const list = await renderList({ sessions: [session("root")] });

    expect(row(list).querySelector(".orphan-marker")).toBeNull();
    expect(row(list).querySelector(".row-badges")).toBeNull();
    expect(row(list).querySelector("small")?.textContent).toBe("3 messages");
  });

  it("shows a nested child under a present parent with the ordinary child marker", async () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await renderList({ sessions: [parent, child] });

    const childRow = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []][1];
    expect(childRow?.querySelector(".tree-marker")?.textContent).toBe("↳");
    expect(childRow?.querySelector(".orphan-marker")).toBeNull();
  });
});

describe("children in other workspaces", () => {
  it("states the count on the meta line, where a long title cannot clamp it away", async () => {
    const longName = "A very long session name ".repeat(20);
    const list = await renderList({ sessions: [session("parent", { name: longName, childSessionsElsewhere: 2 })] });

    expect(row(list).querySelector("small")?.textContent).toBe("2 children elsewhere · 3 messages");
  });

  it("uses singular wording for a single child elsewhere", async () => {
    const list = await renderList({ sessions: [session("parent", { childSessionsElsewhere: 1 })] });

    expect(row(list).querySelector("small")?.textContent).toBe("1 child elsewhere · 3 messages");
  });

  it("says nothing for a session with no children elsewhere", async () => {
    const list = await renderList({ sessions: [session("parent"), session("zero", { childSessionsElsewhere: 0 })] });

    expect(row(list, 0).querySelector("small")?.textContent).toBe("3 messages");
    expect(row(list, 1).querySelector("small")?.textContent).toBe("3 messages");
  });

  it("uses no badge, so the badge area stays reserved for depth", async () => {
    const list = await renderList({ sessions: [session("parent", { childSessionsElsewhere: 3 })] });

    expect(row(list).querySelector(".row-badges")).toBeNull();
  });

  it("states both directions on one meta line for a child that is itself a parent", async () => {
    const list = await renderList({
      sessions: [orphan({ childSessionsElsewhere: 1 })],
      parentLocation: () => workspaceLocation,
    });

    expect(row(list).querySelector("small")?.textContent).toBe("parent in feature/parent-links · 1 child elsewhere · 3 messages");
  });

  it("keeps the transient-session prefix ahead of cross-workspace details", async () => {
    const list = await renderList({ sessions: [session("new", { persisted: false, childSessionsElsewhere: 2 })] });

    expect(row(list).querySelector("small")?.textContent).toBe("new · 2 children elsewhere · 3 messages");
  });
});

describe("go to parent session action", () => {
  it("offers the action for a resolvable parent workspace and forwards the location", async () => {
    const orphanSession = orphan();
    const onGoToParent = vi.fn<(session: SessionInfo, location: ParentSessionLocation) => void>();
    const list = await renderList({ sessions: [orphanSession], parentLocation: () => workspaceLocation, onGoToParent });

    await openMenu(list);
    menuButton(list, "Go to parent session").click();

    expect(onGoToParent).toHaveBeenCalledWith(orphanSession, workspaceLocation);
  });

  it("omits the action when the parent workspace cannot be resolved", async () => {
    const list = await renderList({
      sessions: [orphan()],
      parentLocation: () => ({ kind: "path", label: "…/other/dir", cwd: "/srv/other/dir" }),
      onGoToParent: vi.fn(),
    });

    await openMenu(list);
    expect(findMenuButton(list, "Go to parent session")).toBeUndefined();
  });

  it("omits the action for a session whose parent is present in the list", async () => {
    const parent = session("parent");
    const list = await renderList({
      sessions: [parent, session("child", { parentSessionPath: parent.path })],
      parentLocation: () => workspaceLocation,
      onGoToParent: vi.fn(),
    });

    await openMenu(list, 1);
    expect(findMenuButton(list, "Go to parent session")).toBeUndefined();
  });
});

async function renderList(options: {
  sessions: SessionInfo[];
  parentLocation?: (session: SessionInfo) => ParentSessionLocation;
  onGoToParent?: (session: SessionInfo, location: ParentSessionLocation) => void;
}): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = options.sessions;
  if (options.parentLocation !== undefined) list.parentLocation = options.parentLocation;
  if (options.onGoToParent !== undefined) list.onGoToParent = options.onGoToParent;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function row(list: SessionList, index = 0): Element {
  const found = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []][index];
  if (found === undefined) throw new Error(`No session row at index ${String(index)}`);
  return found;
}

async function openMenu(list: SessionList, index = 0): Promise<void> {
  row(list, index).querySelector<HTMLButtonElement>(".action-menu-toggle")?.click();
  await list.updateComplete;
}

function findMenuButton(list: SessionList, text: string): HTMLButtonElement | undefined {
  return [...list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".action-menu-panel button") ?? []]
    .find((button) => button.textContent.trim() === text);
}

function menuButton(list: SessionList, text: string): HTMLButtonElement {
  const button = findMenuButton(list, text);
  if (button === undefined) throw new Error(`No menu button labelled ${text}`);
  return button;
}

function orphan(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return session("child", {
    parentSessionPath: "/sessions/--srv-dev-pi-web-feature--/parent.jsonl",
    parentSessionCwd: "/srv/dev/pi-web-feature",
    parentSessionId: "parent-id",
    ...overrides,
  });
}

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/sessions/${id}.jsonl`,
    cwd: "/srv/dev/pi-web",
    created: "2026-07-28T00:00:00.000Z",
    modified: "2026-07-28T00:00:00.000Z",
    messageCount: 3,
    firstMessage: id,
    ...overrides,
  };
}
