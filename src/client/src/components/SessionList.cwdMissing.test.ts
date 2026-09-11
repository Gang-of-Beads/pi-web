// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "./SessionList";
import type { SessionInfo } from "../../../shared/apiTypes";
import { SessionList } from "./SessionList";

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/tmp/${id}.jsonl`,
    cwd: "/repo",
    created: "2026-06-25T00:00:00.000Z",
    modified: "2026-06-25T00:01:00.000Z",
    messageCount: 1,
    firstMessage: "",
    ...overrides,
  };
}

describe("SessionList dead-folder rows", () => {
  beforeEach(() => {
    document.body.innerHTML = "<session-list></session-list>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  async function mount(sessions: SessionInfo[]): Promise<SessionList> {
    const list = document.body.querySelector<SessionList>("session-list");
    if (list === null) throw new Error("session list did not mount");
    list.sessions = sessions;
    await list.updateComplete;
    return list;
  }

  it("renders a dead-folder session as a resting row, not a button", async () => {
    const list = await mount([session("dead", { cwdMissing: true }), session("live")]);
    const rows = [...list.renderRoot.querySelectorAll(".action-main")];
    const deadRow = rows.find((row) => row.classList.contains("cwd-missing-row"));
    expect(deadRow).toBeDefined();
    expect(deadRow?.tagName).toBe("DIV");
    expect(deadRow?.querySelector(".cwd-gone")?.textContent).toContain("folder gone");
    const liveButton = rows.find((row) => row.tagName === "BUTTON");
    expect(liveButton).toBeDefined();
  });

  it("does not select a dead row on click", async () => {
    let selectedId: string | undefined;
    const list = await mount([session("dead", { cwdMissing: true }), session("live")]);
    list.onSelect = (picked) => { selectedId = picked.id; };
    await list.updateComplete;
    const deadRow = list.renderRoot.querySelector(".cwd-missing-row");
    deadRow?.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    expect(selectedId).toBeUndefined();
  });
});
