// @vitest-environment happy-dom

import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";
import type { QualifiedMessageRendererContribution } from "../plugins/types";

function customLine(tag: string, payload: unknown = { question: "Ship it?" }): ChatLine {
  return { role: "assistant", parts: [{ type: "custom", tag, payload }] };
}

function renderer(patch: Partial<QualifiedMessageRendererContribution> = {}): QualifiedMessageRendererContribution {
  return {
    id: "polls:poll",
    pluginId: "polls",
    localId: "poll",
    tag: "poll",
    render: () => html`<div class="poll-body">Ship it?</div>`,
    ...patch,
  };
}

async function viewWith(lines: ChatLine[], find?: (tag: string) => QualifiedMessageRendererContribution | undefined): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.messages = lines;
  if (find !== undefined) view.findMessageRenderer = find;
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

describe("plugin message renderers in the transcript", () => {
  it("renders the claiming plugin's body inside the card chrome", async () => {
    const view = await viewWith([customLine("poll")], () => renderer());

    const card = view.shadowRoot?.querySelector(".custom-card");

    expect(card?.querySelector(".poll-body")?.textContent).toBe("Ship it?");
    expect(card?.classList.contains("custom-card-unknown")).toBe(false);
  });

  it("renders an honest unknown card when nobody claims the tag", async () => {
    const view = await viewWith([customLine("chart")], () => undefined);

    const card = view.shadowRoot?.querySelector(".custom-card-unknown");

    expect(card?.textContent).toContain("Unrecognized message");
    expect(card?.textContent).toContain("chart");
  });

  it("renders the unknown card when no registry is wired at all", async () => {
    const view = await viewWith([customLine("poll")]);

    expect(view.shadowRoot?.querySelector(".custom-card-unknown")).not.toBeNull();
  });

  it("hands the renderer the tag and payload it was given", async () => {
    const seen: unknown[] = [];
    const render = (view: unknown) => { seen.push(view); return html`<div></div>`; };
    await viewWith([customLine("poll", { choice: 2 })], () => renderer({ render }));

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]).toMatchObject({ tag: "poll", payload: { choice: 2 }, sessionId: "session-1" });
  });

  it("survives a renderer that throws and says so in place", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const view = await viewWith([customLine("poll")], () => renderer({ render: () => { throw new Error("boom"); } }));

      expect(view.shadowRoot?.querySelector(".custom-card")?.textContent).toContain("could not be rendered");
    } finally {
      errors.mockRestore();
    }
  });

  it("keeps the plugin body inside chrome the plugin does not control", async () => {
    const view = await viewWith([customLine("poll")], () => renderer());

    const body = view.shadowRoot?.querySelector(".poll-body");

    expect(body?.closest(".custom-card")).not.toBeNull();
  });
});
