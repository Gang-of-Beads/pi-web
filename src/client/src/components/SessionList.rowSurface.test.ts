// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => { document.body.replaceChildren(); });

/**
 * A row was two separately outlined boxes butted together: the body carried
 * `border: 1px 1px 1px 3px` and the overflow menu carried `1px 1px 1px 0`, so
 * their shared edge stacked into a hard vertical rule and the row read as a
 * table cell rather than as one thing.
 *
 * A row is one surface. The menu is an affordance inside it, not a second
 * panel beside it.
 */
describe("a session row is one surface", () => {
  it("does not outline the overflow menu as a box of its own", async () => {
    const list = await renderList();
    const menu = list.shadowRoot?.querySelector(".action-menu-toggle");
    if (menu === null || menu === undefined) throw new Error("Expected an overflow menu control");

    const style = getComputedStyle(menu);
    const widths = [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth];
    expect(widths.every((width) => parseFloat(width) === 0), `menu borders were ${widths.join(",")}`).toBe(true);
  });

  it("states the row's own colour once rather than per part", () => {
    const sheet = String(SessionList.styles);
    // The selected treatment used to be painted onto both boxes, which is what
    // made the seam between them visible in the first place.
    expect(sheet).not.toMatch(/\.selected\s+\.action-main,\s*\.action-row\.selected\s+\.action-menu-toggle/u);
  });
});

async function renderList(): Promise<SessionList> {
  const list = new SessionList();
  const only = session("p1", "pi-web");
  list.sessions = [only];
  list.selected = only;
  document.body.append(list);
  await list.updateComplete;
  return list;
}

function session(id: string, name: string): SessionInfo {
  return {
    id, name, path: `/s/${id}.jsonl`, cwd: "/w",
    created: "2026-08-26T00:00:00.000Z", modified: "2026-08-26T00:00:00.000Z",
    messageCount: 927, firstMessage: "",
  };
}
