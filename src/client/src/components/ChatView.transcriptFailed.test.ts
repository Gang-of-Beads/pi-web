// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";

/**
 * A failed transcript read must never render as an empty session. The live
 * reproduction: a session whose working directory was deleted lists with 32
 * messages, its read fails with the daemon's precise words - and the surface
 * claimed "This session is empty. Send a message to start it." Absence is not
 * negation, and a failed read is absence.
 */
async function mount(configure: (view: ChatView) => void): Promise<ChatView> {
  document.body.innerHTML = "<chat-view></chat-view>";
  const view = document.body.querySelector<ChatView>("chat-view");
  if (view === null) throw new Error("chat view did not mount");
  view.messages = [];
  configure(view);
  await view.updateComplete;
  return view;
}

describe("a failed transcript read says so", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders the daemon's own words instead of the empty claim", async () => {
    const view = await mount((v) => { v.transcriptFailed = "Stored session working directory does not exist: /private/tmp/test"; });
    const text = view.renderRoot.textContent;
    expect(text).toContain("Couldn't load this session");
    expect(text).toContain("Stored session working directory does not exist");
    expect(text).not.toContain("This session is empty");
    expect(text).not.toContain("Write the first message");
  });

  it("still claims emptiness only when the read succeeded", async () => {
    const view = await mount(() => undefined);
    const text = view.renderRoot.textContent;
    expect(text).toContain("This session is empty");
  });

  it("says loading while the read is still under way, failure or not", async () => {
    const view = await mount((v) => { v.transcriptLoading = true; });
    expect(view.renderRoot.textContent).toContain("Loading this session");
  });
});
