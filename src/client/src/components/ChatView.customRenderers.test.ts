// @vitest-environment happy-dom

import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { ChatLine } from "./shared";
import type { QualifiedMessageRendererContribution } from "../plugins/types";

function customLine(tag: string, payload: unknown = { question: "Ship it?" }): ChatLine {
  return { role: "assistant", parts: [{ type: "custom", tag, payload, kind: "message" }] };
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
    expect(card?.classList.contains("custom-card-default")).toBe(false);
  });

  it("draws pi's default, the type, when nobody claims the tag", async () => {
    const view = await viewWith([customLine("chart")], () => undefined);

    const card = view.shadowRoot?.querySelector(".custom-card-default");

    expect(card?.textContent).toContain("[chart]");
  });

  it("draws the default when no registry is wired at all", async () => {
    const view = await viewWith([customLine("poll")]);

    expect(view.shadowRoot?.querySelector(".custom-card-default")).not.toBeNull();
  });

  it("tells the renderer what the reader said after the card, and only after it", async () => {
    const render = vi.fn<QualifiedMessageRendererContribution["render"]>(() => html`<div class="poll-body">Ship it?</div>`);
    const said = (text: string): ChatLine => ({ role: "user", parts: [{ type: "text", text }] });

    await viewWith([said("before the card"), customLine("poll"), said("yes"), { role: "assistant", parts: [{ type: "text", text: "noted" }] }, said("and ship")], () => renderer({ render }));

    const lastView: unknown = render.mock.lastCall?.[0];
    expect(lastView).toMatchObject({ followingUserTexts: ["yes", "and ship"] });
  });

  it("gives each of several cards only what was said after it", async () => {
    const seen: { payload: unknown; following: readonly string[] | undefined }[] = [];
    const render = vi.fn<QualifiedMessageRendererContribution["render"]>((view) => { seen.push({ payload: view.payload, following: view.followingUserTexts }); return html`<div></div>`; });
    const said = (text: string): ChatLine => ({ role: "user", parts: [{ type: "text", text }] });

    await viewWith([customLine("poll", "first"), said("one"), customLine("poll", "second"), said("two")], () => renderer({ render }));

    const last = (payload: string) => seen.filter((entry) => entry.payload === payload).at(-1)?.following;
    expect({ first: last("first"), second: last("second") }).toEqual({ first: ["one", "two"], second: ["two"] });
  });

  it("keeps its reply index across renders that hand it a fresh empty queue", async () => {
    const view = await viewWith([customLine("poll", "first"), { role: "user", parts: [{ type: "text", text: "one" }] }], () => renderer());
    const built: unknown = Reflect.get(view, "followingIndex");
    view.clientQueuedMessages = [];
    await view.updateComplete;

    expect({ built: built !== undefined, reused: Reflect.get(view, "followingIndex") === built }).toEqual({ built: true, reused: true });
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
