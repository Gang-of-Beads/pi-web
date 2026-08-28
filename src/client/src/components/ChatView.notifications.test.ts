// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "./ChatView";
import type { SelectedSessionNotificationView } from "../sessionNotifications";

afterEach(() => {
  document.body.replaceChildren();
});

function inbox(ids: readonly string[]): SelectedSessionNotificationView {
  return {
    machineId: "local",
    sessionId: "session-1",
    cwd: "/repo",
    daemonInstanceId: "daemon-a",
    notifications: ids.map((id, index) => ({
      id,
      message: `notification ${id}`,
      truncated: false,
      severity: "warning" as const,
      receivedAt: "2026-07-18T00:00:00.000Z",
      order: index + 1,
    })),
    retainedCount: ids.length,
    discardedCount: 0,
    ...(ids.length === 0 ? {} : { highestSeverity: "warning" as const }),
    dismissThrough: { order: ids.length, overflowWatermark: 0 },
    pendingDismissedIds: new Set<string>(),
    dismissAllPending: false,
    announcements: [],
  };
}

async function mount(ids: readonly string[]): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  view.notificationInbox = inbox(ids);
  document.body.append(view);
  await view.updateComplete;
  await view.updateComplete;
  return view;
}

function dismissControls(view: ChatView): HTMLButtonElement[] {
  return [...view.renderRoot.querySelectorAll<HTMLButtonElement>(".notification-row-dismiss")];
}

describe("dismissing one notification", () => {
  it("asks to dismiss the row that was pressed", async () => {
    const view = await mount(["daemon-a:1"]);
    const onDismissNotification = vi.fn();
    view.onDismissNotification = onDismissNotification;
    await view.updateComplete;

    const [dismiss] = dismissControls(view);
    if (dismiss === undefined) throw new Error("expected a dismiss control on the row");
    dismiss.click();

    expect(onDismissNotification).toHaveBeenCalledExactlyOnceWith("daemon-a:1");
  });

  /**
   * The owner tapped dismiss and the list moved under his finger. Rows rendered
   * by position let Lit reuse the element at each index and rewrite its text, so
   * the control a finger is travelling towards can belong to another
   * notification by the time it lands - and the tap dismisses the wrong row, or
   * the row he wanted is still there and he taps again.
   */
  it("keeps each row's control attached to its own notification when the list shortens", async () => {
    const view = await mount(["daemon-a:1", "daemon-a:2", "daemon-a:3"]);
    const dismissed: string[] = [];
    view.onDismissNotification = (id: string) => { dismissed.push(id); };
    await view.updateComplete;

    const beforeControls = dismissControls(view);
    expect(beforeControls).toHaveLength(3);
    const lastControl = beforeControls[2];

    // The first notification clears elsewhere, so every later row moves up one.
    view.notificationInbox = inbox(["daemon-a:2", "daemon-a:3"]);
    await view.updateComplete;
    await view.updateComplete;

    const afterControls = dismissControls(view);
    expect(afterControls).toHaveLength(2);
    // The row that moved kept its element rather than inheriting a neighbour's.
    expect(afterControls[1]).toBe(lastControl);

    afterControls[1]?.click();
    expect(dismissed).toEqual(["daemon-a:3"]);
  });
});
