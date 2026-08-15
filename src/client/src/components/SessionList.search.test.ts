// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

describe("SessionList search", () => {
  it("hides the search field for short lists", async () => {
    const list = await renderSessionList([session("a"), session("b")]);

    expect(searchInput(list)).toBeNull();
  });

  it("filters rows to matching sessions once a query is typed", async () => {
    const list = await renderSessionList([
      session("a", { name: "billing refactor" }),
      session("b", { name: "mobile layout" }),
      session("c", { name: "prompt editor" }),
      session("d", { name: "terminal panel" }),
      session("e", { name: "workspace files" }),
    ]);

    await typeSearch(list, "mobile");

    expect(rowNames(list)).toEqual(["mobile layout"]);
  });

  it("reveals archived matches without expanding the archived section first", async () => {
    const list = await renderSessionList([
      session("a", { name: "billing refactor" }),
      session("b", { name: "mobile layout" }),
      session("c", { name: "prompt editor" }),
      session("d", { name: "terminal panel" }),
      session("e", { name: "archived websocket fix", archived: true }),
    ]);

    await typeSearch(list, "websocket");

    expect(rowNames(list)).toEqual(["archived websocket fix"]);
  });

  it("reports an empty result instead of rendering a blank list", async () => {
    const list = await renderSessionList(Array.from({ length: 5 }, (_, index) => session(String(index), { name: `session ${String(index)}` })));

    await typeSearch(list, "zzzz");

    expect(rowNames(list)).toEqual([]);
    expect(list.renderRoot.querySelector(".search-empty")?.textContent).toContain("zzzz");
  });

  it("clears the query from the clear button and restores every row", async () => {
    const list = await renderSessionList(Array.from({ length: 5 }, (_, index) => session(String(index), { name: `session ${String(index)}` })));

    await typeSearch(list, "session 3");
    expect(rowNames(list)).toEqual(["session 3"]);

    list.renderRoot.querySelector<HTMLButtonElement>(".session-search-clear")?.click();
    await list.updateComplete;

    expect(rowNames(list)).toHaveLength(5);
  });

  it("keeps the field mounted after filtering down to a short result", async () => {
    const list = await renderSessionList(Array.from({ length: 5 }, (_, index) => session(String(index), { name: `session ${String(index)}` })));

    await typeSearch(list, "session 1");

    expect(searchInput(list)).not.toBeNull();
  });
});

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/repo/.pi/sessions/${id}.jsonl`,
    cwd: "/repo",
    persisted: true,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "",
    ...overrides,
  };
}

async function renderSessionList(sessions: SessionInfo[]): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function searchInput(list: SessionList): HTMLInputElement | null {
  return list.renderRoot.querySelector<HTMLInputElement>(".session-search-input");
}

async function typeSearch(list: SessionList, value: string): Promise<void> {
  const input = searchInput(list);
  if (input === null) throw new Error("Expected the session search input");
  input.value = value;
  input.dispatchEvent(new Event("input"));
  await list.updateComplete;
}

function rowNames(list: SessionList): string[] {
  return [...list.renderRoot.querySelectorAll<HTMLElement>(".action-row .action-name")].map((element) => element.textContent.trim());
}
