// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("subagent subtree collapse", () => {
  it("shows a collapsible toggle on a parent row with descendants", async () => {
    const parent = session("parent");
    const list = await renderList({ sessions: [parent, session("child", { parentSessionPath: parent.path })] });

    const toggle = row(list).querySelector<HTMLButtonElement>(".subtree-toggle");
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.getAttribute("aria-label")).toBe("Collapse subagents under parent");
  });

  it("hides descendant rows after collapsing the subtree", async () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await renderList({ sessions: [parent, child] });

    toggle(list)?.click();
    await list.updateComplete;

    const rows = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []];
    expect(rows.map((r) => r.textContent?.includes("child"))).toEqual([false]);
    expect(toggle(list)?.getAttribute("aria-expanded")).toBe("false");
    expect(toggle(list)?.getAttribute("aria-label")).toBe("Expand subagents under parent");
  });

  it("expands a collapsed subtree again on a second click", async () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await renderList({ sessions: [parent, child, session("sibling")] });

    toggle(list)?.click();
    await list.updateComplete;
    toggle(list)?.click();
    await list.updateComplete;

    const rows = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []];
    // parent + child + sibling: child is visible again.
    expect(rows).toHaveLength(3);
  });

  it("only collapses the clicked subtree, not other parents", async () => {
    const parentA = session("parent-a");
    const parentB = session("parent-b");
    const list = await renderList({
      sessions: [
        parentA,
        session("child-a", { parentSessionPath: parentA.path }),
        parentB,
        session("child-b", { parentSessionPath: parentB.path }),
      ],
    });

    const toggles = [...list.shadowRoot?.querySelectorAll<HTMLButtonElement>(".subtree-toggle") ?? []];
    expect(toggles).toHaveLength(2);
    toggles[0]?.click();
    await list.updateComplete;

    const rows = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []];
    expect(rows.map((r) => r.querySelector(".action-name")?.textContent)).toEqual(["parent-a", "parent-b", "↳child-b"]);
  });

  it("keeps descendants visible while searching even when collapsed", async () => {
    const parent = session("parent");
    const child = session("child", { parentSessionPath: parent.path });
    const list = await renderList({ sessions: [parent, child] });

    toggle(list)?.click();
    await list.updateComplete;

    // Simulate an active search query the same way the session-search input
    // does, by setting the state the list derives its filtering from.
    (list as unknown as { searchQuery: string }).searchQuery = "child";
    list.requestUpdate();
    await list.updateComplete;

    const rows = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []];
    expect(rows.some((r) => r.textContent?.includes("child"))).toBe(true);
  });

  it("renders no toggle for leaf sessions", async () => {
    const list = await renderList({ sessions: [session("leaf")] });
    expect(row(list).querySelector(".subtree-toggle")).toBeNull();
  });
});

async function renderList(options: { sessions: SessionInfo[] }): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = options.sessions;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function row(list: SessionList, index = 0): Element {
  const found = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []][index];
  if (found === undefined) throw new Error(`No session row at index ${String(index)}`);
  return found;
}

function toggle(list: SessionList, index = 0): HTMLButtonElement | null {
  return row(list, index).querySelector<HTMLButtonElement>(".subtree-toggle");
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