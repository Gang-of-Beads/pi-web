// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The control that expands a session's subagents was a 24px square pinned to
 * the corner of the row, filled with the row's own background and outlined in
 * a border a shade off the row's own. Nothing about it read as a control, so
 * it was found by hunting rather than by looking.
 *
 * A disclosure control earns its place by being legible at rest, not only on
 * hover: a row that can expand should say so before it is touched.
 */
describe("the subagent disclosure control", () => {
  it("is present on a row that has subagents, and absent on one that does not", async () => {
    const list = await renderList();

    const rows = [...list.shadowRoot?.querySelectorAll(".action-row") ?? []];
    expect(rows[0]?.querySelector(".subtree-toggle")).not.toBeNull();
    expect(rows[1]?.querySelector(".subtree-toggle")).toBeNull();
  });

  it("does not rely on the row's own background to be visible", () => {
    const sheet = SessionList.styles.map((style) => String(style)).join("\n");
    const rule = /\.subtree-toggle[^{]*\{([^}]*)\}/u.exec(sheet)?.[1] ?? "";
    expect(rule, "expected a .subtree-toggle rule to exist").not.toBe("");

    // The row paints --pi-surface, so a toggle that also paints --pi-surface
    // has no edge of its own and is left to a near-identical border.
    expect(rule).not.toMatch(/background:\s*var\(--pi-surface\)/u);
  });

  it("says what it will do, for a pointer as well as a screen reader", async () => {
    const list = await renderList();

    const toggle = list.shadowRoot?.querySelector(".subtree-toggle");
    expect(toggle?.getAttribute("title") ?? "").toMatch(/subagent/iu);
  });
});

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
