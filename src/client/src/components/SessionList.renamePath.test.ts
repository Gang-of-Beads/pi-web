// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => { document.body.replaceChildren(); });

function required(root: ParentNode, selector: string): HTMLElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLElement)) throw new Error(`Missing required element: ${selector}`);
  return element;
}

function requiredInput(root: ParentNode, selector: string): HTMLInputElement {
  const element = root.querySelector(selector);
  if (!(element instanceof HTMLInputElement)) throw new Error(`Missing required input: ${selector}`);
  return element;
}

/**
 * The resident bar once carried an inline rename; it now lives only in the
 * session row menu. That menu is the single rename entry, so the path
 * menu → Rename → dialog must stay wired end to end.
 */
describe("the session row menu rename path", () => {
  function session(patch: Partial<SessionInfo> = {}): SessionInfo {
    return {
      id: "019f22c5-d53e-7489-997f-fce17c4dc82f",
      cwd: "/repo",
      path: "/repo/.pi/session.jsonl",
      created: "2026-08-28T10:00:00.000Z",
      modified: "2026-08-28T10:00:00.000Z",
      messageCount: 1,
      firstMessage: "Start",
      name: "Ship the release",
      ...patch,
    };
  }

  async function mount(overrides: Partial<SessionList> = {}): Promise<SessionList> {
    const list = new SessionList();
    Object.assign(list, overrides);
    document.body.append(list);
    await list.updateComplete;
    return list;
  }

  it("opens the rename dialog from the row menu and hands the name back", async () => {
    const renames: { session: SessionInfo; name: string }[] = [];
    const target = session();
    const list = await mount({
      sessions: [target],
      onRename: (renamed, name) => { renames.push({ session: renamed, name }); },
    });

    required(list.renderRoot, ".action-menu-toggle").click();
    await list.updateComplete;
    const renameButton = [...list.renderRoot.querySelectorAll("button")]
      .find((node) => node.textContent.trim() === "Rename");
    if (renameButton === undefined) throw new Error("Row menu has no Rename entry");
    renameButton.click();
    await list.updateComplete;

    const dialog = list.renderRoot.querySelector("session-rename-dialog");
    if (dialog === null) throw new Error("Rename dialog did not open from the row menu");
    const input = requiredInput(dialog.renderRoot, "input");
    input.value = "Renamed from the panel";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const form = dialog.renderRoot.querySelector("form");
    if (form === null) throw new Error("Rename dialog has no form to submit");
    form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    await list.updateComplete;

    expect(renames).toEqual([{ session: target, name: "Renamed from the panel" }]);
  });
});
