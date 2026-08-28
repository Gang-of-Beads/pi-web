// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { SUBAGENT_INTERVENTION_UNAVAILABLE, subagentRunConversationView } from "../appState";
import { ChatView } from "./ChatView";
import { hasRenderedModal } from "./modalLayerRegistry";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-parent";
  view.messages = [{ role: "user", parts: [{ type: "text", text: "the parent's own turn" }] }];
  document.body.append(view);
  await view.updateComplete;
  return view;
}

/**
 * Opening the dialog registers a modal from within `updated()`, which schedules
 * another render. Settling both leaves the view in the state a reader sees.
 */
async function openConversation(view: ChatView, conversation: ChatView["activityConversation"]): Promise<void> {
  view.activityConversation = conversation;
  await view.updateComplete;
  await view.updateComplete;
}

function dialog(view: ChatView): HTMLDialogElement {
  const found = view.shadowRoot?.querySelector<HTMLDialogElement>("dialog.activity-conversation");
  if (found === null || found === undefined) throw new Error("expected the activity conversation dialog");
  return found;
}

/** What a `<formatted-text>` was handed to draw; it keeps the words in its own root. */
function spokenText(element: Element): string | undefined {
  if (!("text" in element)) return undefined;
  const { text } = element;
  return typeof text === "string" ? text : undefined;
}

/** The shape the server sends: raw messages, exactly as the transcript route does. */
const CHILD_PAGE = {
  messages: [
    { role: "user", content: "find the caller" },
    { role: "assistant", content: "Reading the file now." },
  ],
  total: 2,
};

const RUN = { runId: "139dd2a2-36b9-4bd1-8c95-ae2c13829a12", agent: "worker", status: "running" };

describe("ChatView subagent run conversation", () => {
  /**
   * The regression this closes: the click populated state that nothing read,
   * so a row that used to open a text blob opened nothing at all.
   */
  it("opens the child's conversation when a run is handed to it", async () => {
    const view = await mountView();
    expect(dialog(view).open).toBe(false);

    await openConversation(view, subagentRunConversationView(RUN, CHILD_PAGE));

    expect(dialog(view).open).toBe(true);
    expect(hasRenderedModal(document)).toBe(true);
  });

  it("renders the child's turns as messages rather than as a block of text", async () => {
    const view = await mountView();

    await openConversation(view, subagentRunConversationView(RUN, CHILD_PAGE));

    const body = dialog(view).querySelector(".activity-conversation-body");
    expect(body?.querySelectorAll("article.msg").length).toBe(2);
    // Text travels to <formatted-text>, which keeps it in its own shadow root,
    // so the turn's words are read off the element rather than off textContent.
    const spoken = [...(body?.querySelectorAll("formatted-text") ?? [])].map(spokenText);
    expect(spoken).toContain("Reading the file now.");
    expect(spoken).toContain("find the caller");
    // The blob viewer's <pre> is what this replaced.
    expect(body?.querySelector("pre")).toBeNull();
  });

  /**
   * A child's conversation sits over the parent's. Without its own name it
   * reads as the transcript underneath, which is a different conversation.
   */
  it("says whose run it is and offers a way back", async () => {
    const view = await mountView();

    await openConversation(view, subagentRunConversationView(RUN, CHILD_PAGE));

    const opened = dialog(view);
    expect(opened.textContent).toContain("worker");
    expect(opened.textContent).toContain("139dd2a2");
    expect(opened.textContent).toContain("Child run of this session");
    expect(opened.querySelector(".activity-conversation-close")).not.toBeNull();
  });

  /**
   * A reader watching a child work will reach for a way to steer it. The
   * boundary is real - steering rides the Pi event bus, which this server does
   * not hold - so the view states it instead of leaving an unexplained gap.
   */
  it("states that steering the run is not available here", async () => {
    const view = await mountView();

    await openConversation(view, subagentRunConversationView(RUN, CHILD_PAGE));

    expect(dialog(view).textContent).toContain(SUBAGENT_INTERVENTION_UNAVAILABLE);
  });

  it("closes on the close control and releases the modal layer", async () => {
    const view = await mountView();
    const closed = vi.fn();
    view.onCloseActivityConversation = closed;
    await openConversation(view, subagentRunConversationView(RUN, CHILD_PAGE));

    dialog(view).querySelector<HTMLButtonElement>(".activity-conversation-close")?.click();
    expect(closed).toHaveBeenCalledTimes(1);

    view.activityConversation = undefined;
    await view.updateComplete;
    expect(dialog(view).open).toBe(false);
    expect(hasRenderedModal(document)).toBe(false);
  });

  /**
   * A child that has opened a transcript but not written to it yet is a real
   * state, and it must not look like a view that failed to load.
   */
  it("says the child has not spoken yet rather than showing an empty frame", async () => {
    const view = await mountView();

    await openConversation(view, subagentRunConversationView(RUN, { messages: [], total: 0 }));

    const opened = dialog(view);
    expect(opened.open).toBe(true);
    expect(opened.textContent).toContain("has not written anything yet");
  });

  /**
   * The child's turns belong to the child. Rendering them through the
   * transcript's own list would have put them in the conversation the reader
   * is in, and drawing them with `renderMessage` would have stamped the
   * parent's scroll anchors onto rows outside its scroller.
   */
  it("keeps the child's turns out of the parent's transcript", async () => {
    const view = await mountView();

    await openConversation(view, subagentRunConversationView(RUN, CHILD_PAGE));

    const transcript = view.shadowRoot?.querySelector(".chat");
    expect(transcript?.textContent).not.toContain("Reading the file now.");
    const childRows = dialog(view).querySelectorAll(".activity-conversation-body article.msg");
    expect(childRows.length).toBe(2);
    for (const row of childRows) expect(row.getAttribute("data-scroll-anchor-id")).toBeNull();
  });
});
