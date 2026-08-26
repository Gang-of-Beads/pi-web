// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { SessionInfo } from "../api";
import { SessionList } from "./SessionList";

afterEach(() => { document.body.replaceChildren(); });

/**
 * The three controls in the sessions heading do different kinds of work -
 * starting a session, deleting old ones, and switching into multi-select - and
 * were drawn identically: same border, same background, same text colour, same
 * weight. Only their widths differed, so nothing said which one was the thing
 * you normally came here to do, or which one destroys something.
 */
describe("the sessions heading ranks its actions", () => {
  it("gives the primary action a look the secondary ones do not share", async () => {
    const list = await renderList();
    const root = shadow(list);

    const start = required(root.querySelector(".start-session-button"), "start button");
    const cleanup = required(root.querySelector(".cleanup-entry"), "cleanup button");

    const startStyle = getComputedStyle(start);
    const cleanupStyle = getComputedStyle(cleanup);
    expect(
      startStyle.backgroundColor !== cleanupStyle.backgroundColor
      || startStyle.color !== cleanupStyle.color
      || startStyle.fontWeight !== cleanupStyle.fontWeight,
      "the primary and secondary actions render identically",
    ).toBe(true);
  });

  it("keeps the quiet actions from carrying the same border as the primary one", () => {
    const sheet = String(SessionList.styles);
    // A quiet action states itself with text; an outline on all three is what
    // flattened the row into three equal buttons.
    expect(sheet).toMatch(/\.cleanup-entry[^{]*\{[^}]*border:\s*0/u);
  });
});

function shadow(list: SessionList): ShadowRoot {
  const root = list.shadowRoot;
  if (root === null) throw new Error("Expected a session-list shadow root");
  return root;
}

function required<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

async function renderList(): Promise<SessionList> {
  const list = new SessionList();
  list.sessions = [{
    id: "p1", name: "pi-web", path: "/s/p1.jsonl", cwd: "/w",
    created: "2026-08-26T00:00:00.000Z", modified: "2026-08-26T00:00:00.000Z",
    messageCount: 927, firstMessage: "",
  } satisfies SessionInfo];
  document.body.append(list);
  await list.updateComplete;
  return list;
}
