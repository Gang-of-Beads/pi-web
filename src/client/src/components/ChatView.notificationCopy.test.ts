// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { SelectedSessionNotificationView } from "../sessionNotifications";

// The clipboard itself belongs to the browser; what is worth pinning here is
// that the button hands it the right text.
const writeClipboardText = vi.hoisted(() => vi.fn<(text: string) => Promise<boolean>>(() => Promise.resolve(true)));
vi.mock("../clipboard", () => ({ writeClipboardText }));

const MESSAGE = 'Anthropic account "personal" failed closed: token refresh request failed.\nurl=https://platform.claude.com/v1/oauth/token';

afterEach(() => {
  document.body.replaceChildren();
});

function inboxWithNotification(): SelectedSessionNotificationView {
  return {
    machineId: "local",
    sessionId: "session-1",
    cwd: "/repo",
    daemonInstanceId: "daemon-a",
    notifications: [{
      id: "daemon-a:1",
      message: MESSAGE,
      truncated: false,
      severity: "error",
      receivedAt: "2026-08-18T11:20:00.000Z",
      order: 1,
    }],
    retainedCount: 1,
    discardedCount: 0,
    highestSeverity: "error",
    dismissThrough: { order: 1, overflowWatermark: 0 },
    pendingDismissedIds: new Set(),
    dismissAllPending: false,
    announcements: [],
  };
}

async function renderedView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.notificationInbox = inboxWithNotification();
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

describe("notification copy", () => {
  // A notification is often the only place an error's detail exists -- an
  // account failure, a stack trace, a URL to paste elsewhere. Taking it by
  // drag-selecting wrapped lines inside a scrolling list is painful on a phone,
  // where the drag fights the scroll.
  it("copies the message alone, without severity or timestamp decoration", async () => {
    writeClipboardText.mockClear();
    const view = await renderedView();

    const copy = view.renderRoot.querySelector<HTMLButtonElement>(".notification-row-copy");
    if (copy === null) throw new Error("expected a copy control on the notification row");
    copy.click();
    await Promise.resolve();

    // What gets pasted into a bug report or a search box should be what went
    // wrong, not the chrome the tray drew around it.
    expect(writeClipboardText).toHaveBeenCalledExactlyOnceWith(MESSAGE);
  });
});
