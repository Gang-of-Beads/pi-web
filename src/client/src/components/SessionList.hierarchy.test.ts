// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * A subagent row and the session that started it were drawn identically:
 * same height, same type size, same weight, same colour. The only difference
 * was 16px of indent, and even that inverted once the parent reserved a gutter
 * for its disclosure control, so the child's name began further left than its
 * parent's. Nothing said which row was the work and which was a detail of it.
 */
describe("a child session reads as subordinate to its parent", () => {
  it("marks the row itself with its depth, so styling is not left to indentation", async () => {
    const list = await renderList();

    expect(rowAt(list, 0).classList.contains("is-child")).toBe(false);
    expect(rowAt(list, 1).classList.contains("is-child")).toBe(true);
  });

  it("keeps the child's name to the right of its parent's", async () => {
    const list = await renderList();

    // Reading order carries the relationship: a child that starts further left
    // than its parent reads as a sibling, or as the more important row.
    expect(indentOf(rowAt(list, 1))).toBeGreaterThan(indentOf(rowAt(list, 0)));
  });
});

function indentOf(row: Element): number {
  const depth = Number(getComputedStyle(row).getPropertyValue("--depth").trim() || "0");
  const gutter = row.classList.contains("has-subtree-toggle") ? 0 : 1;
  return depth * 2 + gutter;
}

function rowAt(list: SessionList, index: number): Element {
  const found = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []][index];
  if (found === undefined) throw new Error(`No session row at index ${String(index)}`);
  return found;
}

async function renderList(): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = [session("p1", "Parent"), session("c1", "Child", "/s/p1.jsonl")];
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function session(id: string, name: string, parentSessionPath?: string): SessionInfo {
  return {
    id,
    name,
    path: `/s/${id}.jsonl`,
    cwd: "/w",
    created: "2026-08-26T00:00:00.000Z",
    modified: "2026-08-26T00:00:00.000Z",
    messageCount: 5,
    firstMessage: "",
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}
