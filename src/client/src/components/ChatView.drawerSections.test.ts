// @vitest-environment happy-dom

import { html } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";
import type { QualifiedDrawerSectionContribution } from "../plugins/types";

afterEach(() => { document.body.replaceChildren(); });

function section(patch: Partial<QualifiedDrawerSectionContribution> = {}): QualifiedDrawerSectionContribution {
  return {
    id: "goals:goals",
    pluginId: "goals",
    localId: "goals",
    title: "Goals",
    render: () => html`<div class="goal-list"></div>`,
    ...patch,
  };
}

async function mount(sections: QualifiedDrawerSectionContribution[], sessionId = "s1"): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = sessionId;
  view.drawerSections = sections;
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function contributedTabIds(view: ChatView): string[] {
  return [...(view.shadowRoot?.querySelectorAll("[role=tab]") ?? [])]
    .map((node) => node.id)
    .filter((id) => id.includes(":"));
}

function tabLabels(view: ChatView): string[] {
  return [...(view.shadowRoot?.querySelectorAll("[role=tab] .drawer-tab-label") ?? [])].map((node) => node.textContent.trim());
}

describe("contributed sections in the session drawer", () => {
  it("gives a contributed section its own tab", async () => {
    const view = await mount([section({ id: "polls:polls", pluginId: "polls", localId: "polls", title: "Polls" })]);

    expect(contributedTabIds(view)).toEqual(["drawer-tab-polls:polls"]);
    expect(tabLabels(view)).toContain("Polls");
  });

  it("shows a badge only when the section reports one", async () => {
    const withBadge = await mount([section({ id: "polls:polls", title: "Polls", badge: () => 3 })]);
    const without = await mount([section({ id: "polls:polls", title: "Polls" })]);

    expect(tabLabels(withBadge)).toContain("Polls (3)");
    expect(tabLabels(without)).toContain("Polls");
  });

  it("contributes nothing while no session is selected", async () => {
    const view = await mount([section({ id: "polls:polls", title: "Polls" })], "");

    expect(contributedTabIds(view)).toEqual([]);
  });

  it("renders the drawer even before any section is contributed", async () => {
    const view = await mount([section({ id: "polls:polls", title: "Polls" })]);

    expect(view.renderRoot.querySelector(".drawer-toggle")).not.toBeNull();
  });

  it("hides the tab of a section that answers unavailable", async () => {
    const view = await mount([
      section({ id: "polls:polls", pluginId: "polls", localId: "polls", title: "Polls", available: () => false }),
      section({ id: "tasks:tasks", pluginId: "tasks", localId: "tasks", title: "Tasks" }),
    ]);

    expect(contributedTabIds(view)).toEqual(["drawer-tab-tasks:tasks"]);
  });

  it("disappears entirely when every section answers unavailable", async () => {
    const view = await mount([section({ id: "goals:goals", title: "Goals", available: () => false })]);

    expect(view.renderRoot.querySelector(".top-drawer")).toBeNull();
  });
});
