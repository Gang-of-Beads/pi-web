// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { activityOutputView } from "../appState";
import { ChatView } from "./ChatView";
import { hasRenderedModal } from "./modalLayerRegistry";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-output";
  view.messages = [{ role: "user", parts: [{ type: "text", text: "hello" }] }];
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function dialog(view: ChatView): HTMLDialogElement {
  const found = view.shadowRoot?.querySelector<HTMLDialogElement>("dialog.activity-output");
  if (found === null || found === undefined) throw new Error("expected the activity output dialog");
  return found;
}

describe("ChatView activity output viewer", () => {
  // The log is a file, not a turn: it belongs in a view of its own rather than
  // appended to the transcript as something the agent said.
  it("opens the log in its own view, outside the transcript", async () => {
    const view = await mountView();
    expect(dialog(view).open).toBe(false);

    view.activityOutput = activityOutputView("Background task verify (b09)", "line one\nline two");
    await view.updateComplete;

    const opened = dialog(view);
    expect(opened.open).toBe(true);
    expect(opened.textContent).toContain("Background task verify (b09)");
    expect(opened.querySelector(".activity-output-body")?.textContent).toBe("line one\nline two");
    expect(hasRenderedModal(document)).toBe(true);
    // The conversation is untouched by reading a log: the text lives in the
    // viewer, never in the transcript.
    expect(view.shadowRoot?.querySelector(".chat")?.textContent ?? "").not.toContain("line one");
  });

  it("says an untouched log is empty instead of showing a blank page", async () => {
    const view = await mountView();

    view.activityOutput = activityOutputView("Background task sleep (b84)", "   \n");
    await view.updateComplete;

    const opened = dialog(view);
    expect(opened.querySelector(".activity-output-body")).toBeNull();
    expect(opened.querySelector(".activity-output-empty")?.textContent).toContain("Nothing has been written");
  });

  it("asks to be closed on the close button, on cancel, and on the backdrop", async () => {
    const view = await mountView();
    const closes: number[] = [];
    view.onCloseActivityOutput = () => { closes.push(closes.length); };
    view.activityOutput = activityOutputView("Subagent worker (7c81b29c)", "# report");
    await view.updateComplete;

    const opened = dialog(view);
    opened.querySelector<HTMLButtonElement>(".activity-output-close")?.click();
    opened.dispatchEvent(new Event("cancel", { cancelable: true }));
    opened.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    // Closing is the owner's decision: the view reports, the state decides.
    expect(closes.length).toBe(3);
    expect(view.activityOutput).not.toBeUndefined();
  });

  it("releases the modal layer when the log is put away", async () => {
    const view = await mountView();
    view.activityOutput = activityOutputView("Subagent worker (7c81b29c)", "# report");
    await view.updateComplete;
    expect(hasRenderedModal(document)).toBe(true);

    view.activityOutput = undefined;
    await view.updateComplete;

    expect(dialog(view).open).toBe(false);
    expect(hasRenderedModal(document)).toBe(false);
  });
});
