// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "./ChatView";

/**
 * An empty transcript means "not loaded yet, or empty". Claiming the second
 * before the first is ruled out is how a session that is still syncing invites
 * the reader to "write the first message", then drops a wall of history on top
 * of what they were typing.
 *
 * The component already receives the distinction; it just has to render it.
 */

async function mount(patch: Partial<ChatView>): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  Object.assign(view, patch);
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function bodyText(view: ChatView): string {
  return view.renderRoot.textContent;
}

afterEach(() => { document.body.replaceChildren(); });

describe("an empty transcript states which kind of empty it is", () => {
  it("does not claim the session is empty while the transcript is still loading", async () => {
    const view = await mount({ messages: [], transcriptLoading: true });

    expect(bodyText(view)).not.toContain("This session is empty");
  });

  it("does not offer to write the first message while the transcript is still loading", async () => {
    const view = await mount({ messages: [], transcriptLoading: true, onFocusComposer: () => undefined });

    const buttons = [...view.renderRoot.querySelectorAll("button")].map((b) => b.textContent.trim());
    expect(buttons).not.toContain("Write the first message");
  });

  it("says it is syncing while the transcript is still loading", async () => {
    const view = await mount({ messages: [], transcriptLoading: true });

    expect(bodyText(view).toLowerCase()).toContain("loading");
  });

  it("claims the session is empty once the transcript has loaded", async () => {
    const view = await mount({ messages: [], transcriptLoading: false });

    expect(bodyText(view)).toContain("This session is empty");
  });

  it("says nothing about emptiness once messages have arrived", async () => {
    const view = await mount({
      messages: [{ role: "user", parts: [{ type: "text", text: "hi" }] }],
      transcriptLoading: false,
    });

    expect(bodyText(view)).not.toContain("This session is empty");
  });
});
