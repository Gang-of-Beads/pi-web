// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Archiving a child on its own is an ordinary thing to do, and it moved the row
 * into a section built from a separate tree. Its parent was not in that tree,
 * so the row was marked an orphan and told the reader "Parent session is not
 * available in this workspace" - while the parent sat unarchived one row above.
 *
 * The marker answers "is the parent reachable", so it must not be driven by
 * which of two lists a row happens to be rendered in.
 */
describe("a child archived on its own", () => {
  it("is not called an orphan while its parent is present", async () => {
    const child = { ...session("c1", "Child", "/s/p1.jsonl"), archived: true };
    const list = await renderList([session("p1", "Parent"), child], child);

    const orphan = list.shadowRoot?.querySelector(".orphan-marker");
    expect(orphan).toBeNull();
  });

  it("still marks a child whose parent really is absent", async () => {
    const orphaned = { ...session("c1", "Child", "/s/gone.jsonl"), archived: true };
    const list = await renderList([orphaned], orphaned);

    expect(list.shadowRoot?.querySelector(".orphan-marker")).not.toBeNull();
  });
});

/** Selecting an archived session opens the archived section, which is the
 *  public way in: the expansion flag itself is component state. */
async function renderList(sessions: SessionInfo[], selected: SessionInfo): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = sessions;
  list.selected = selected;
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
