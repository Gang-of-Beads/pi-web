// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";
import type { GoalPanel } from "./GoalPanel";

/**
 * The drawer's goal panel was rendered without a refresh handler, so its
 * control did nothing: a slot that had not been read had no route back, on the
 * surface a phone actually uses. A declared callback that nobody supplies is
 * silent, which is why this is pinned rather than read.
 */
async function mountDrawer(onRefreshGoals: () => void): Promise<ChatView> {
  document.body.innerHTML = "<chat-view></chat-view>";
  const view = document.body.querySelector<ChatView>("chat-view");
  if (view === null) throw new Error("chat view did not mount");
  view.messages = [];
  view.goalsLoad = { state: "unloaded", key: undefined, data: [] };
  view.onRefreshGoals = onRefreshGoals;
  view.onRunGoalCommand = () => undefined;
  await view.updateComplete;
  // Open the drawer the way a reader does; the panel exists only on that tab.
  const tab = view.renderRoot.querySelector<HTMLElement>("#drawer-tab-goals");
  if (tab === null) throw new Error("the drawer offers no goals tab, so this proves nothing");
  tab.click();
  await view.updateComplete;
  return view;
}

function panelRefreshHandler(view: ChatView): (() => void | Promise<void>) | undefined {
  const panel = view.renderRoot.querySelector<GoalPanel>("goal-panel");
  // Not reaching the panel proves nothing about it; say so instead of passing.
  if (panel === null) throw new Error("the drawer rendered no goal panel, so this proves nothing");
  return panel.onRefresh;
}

describe("the drawer's goal panel can start a read", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("hands the panel a refresh handler", async () => {
    const onRefreshGoals = vi.fn();
    const view = await mountDrawer(onRefreshGoals);
    expect(typeof panelRefreshHandler(view)).toBe("function");
  });

  it("calls back when the panel asks for a read", async () => {
    const onRefreshGoals = vi.fn();
    const view = await mountDrawer(onRefreshGoals);
    const handler = panelRefreshHandler(view);
    if (handler === undefined) throw new Error("panel was given no refresh handler");
    void handler();
    expect(onRefreshGoals).toHaveBeenCalledTimes(1);
  });
});
