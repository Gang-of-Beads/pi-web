// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingExtensionDialog } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import { ChatView } from "./ChatView";
import { ExtensionDialogCard } from "./ExtensionDialogCard";

afterEach(() => {
  document.body.replaceChildren();
});

describe("ChatView open extension dialogs", () => {
  it("draws the oldest pending dialog last in the transcript, with nothing after it to push it", async () => {
    const view = await mountView();
    const oldest = openDialog("dlg-1", "Allow file writes?");
    view.pendingDialogs = [oldest, openDialog("dlg-2", "Pick a region", { kind: "select", options: ["eu", "us"] })];
    await view.updateComplete;

    // In the transcript, and last: nothing is appended after a card that is
    // still waiting, so scrolling to the bottom always reaches it, and once it
    // is answered the replies that follow push it up on their own.
    const chat = view.shadowRoot?.querySelector(".chat");
    const rows = [...(chat?.children ?? [])];
    expect(rows.findIndex((row) => row.classList.contains("waiting-slot"))).toBe(rows.length - 1);
    const card = requiredElement(view.shadowRoot?.querySelector<ExtensionDialogCard>(".chat .waiting-slot > extension-dialog-card.open-dialog-card"), "open dialog card");
    expect(card).toBeInstanceOf(ExtensionDialogCard);
    expect(card.dialog).toBe(oldest);
    expect(view.shadowRoot?.querySelector(".queued-dialogs")?.textContent).toContain("1 more extension dialog queued");
  });

  it("renders no queued affordance for a single pending dialog", async () => {
    const view = await mountView();
    view.pendingDialogs = [openDialog("dlg-1", "Allow file writes?")];
    await view.updateComplete;

    expect(view.shadowRoot?.querySelector(".waiting-slot > extension-dialog-card.open-dialog-card")).not.toBeNull();
    expect(view.shadowRoot?.querySelector(".queued-dialogs")).toBeNull();
  });

  it("opens a dialog without scrolling the transcript underneath the reader", async () => {
    const view = await mountView();
    let dialogStartScrolls = 0;
    if (!Reflect.set(view, "scrollToOpenDialog", () => { dialogStartScrolls += 1; })) throw new Error("Could not observe ChatView.scrollToOpenDialog");
    let bottomScrolls = 0;
    if (!Reflect.set(view, "scrollToBottom", () => { bottomScrolls += 1; })) throw new Error("Could not observe ChatView.scrollToBottom");

    view.pendingDialogs = [openDialog("dlg-1", "Allow file writes?")];
    await view.updateComplete;

    expect(dialogStartScrolls).toBe(0);
    // A transcript that follows its newest message is fine; it no longer
    // carries the dialog, so it cannot move it.
    expect(bottomScrolls).toBeLessThanOrEqual(1);
  });

  it("forwards the answer and cancel callbacks to the open dialog card", async () => {
    const view = await mountView();
    const onAnswerDialog = vi.fn();
    const onCancelDialog = vi.fn();
    view.onAnswerDialog = onAnswerDialog;
    view.onCancelDialog = onCancelDialog;
    view.pendingDialogs = [openDialog("dlg-1", "Allow file writes?")];
    await view.updateComplete;

    const card = requiredElement(view.shadowRoot?.querySelector<ExtensionDialogCard>("extension-dialog-card.open-dialog-card"), "open dialog card");
    void card.onAnswer?.("dlg-1", true);
    void card.onCancel?.("dlg-1");

    expect(onAnswerDialog).toHaveBeenCalledWith("dlg-1", true);
    expect(onCancelDialog).toHaveBeenCalledWith("dlg-1");
  });
});

describe("ChatView closed extension dialogs", () => {
  it("renders closed dialogs transiently above the open one and forwards the dismiss callback", async () => {
    const view = await mountView();
    const onDismissClosedDialog = vi.fn();
    view.onDismissClosedDialog = onDismissClosedDialog;
    const closed = closedDialog("dlg-0", "Allow reads?", "answered", true);
    view.closedDialogs = [closed];
    view.pendingDialogs = [openDialog("dlg-1", "Allow file writes?")];
    await view.updateComplete;

    // The settled one stays in the transcript where it happened; the open one
    // waits in its own row, out of reach of anything that arrives.
    const cards = [
      ...(view.shadowRoot?.querySelectorAll<ExtensionDialogCard>(".chat > extension-dialog-card") ?? []),
      ...(view.shadowRoot?.querySelectorAll<ExtensionDialogCard>(".waiting-slot > extension-dialog-card") ?? []),
    ];
    expect(cards).toHaveLength(2);
    const closedCard = requiredElement(cards[0], "closed dialog card");
    expect(closedCard.classList.contains("closed-dialog-card")).toBe(true);
    expect(closedCard.getAttribute("data-scroll-anchor-id")).toBe("closed-dialog:dlg-0");
    expect(closedCard.outcome).toBe(closed);
    expect(cards[1]?.classList.contains("open-dialog-card")).toBe(true);

    closedCard.onDismiss?.("dlg-0");
    expect(onDismissClosedDialog).toHaveBeenCalledWith("dlg-0");
  });
});

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "session-1";
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function requiredElement<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function openDialog(dialogId: string, title: string, overrides: Partial<PendingExtensionDialog> = {}): PendingExtensionDialog {
  return {
    dialogId,
    kind: "confirm",
    title,
    askedAt: "2026-07-27T10:00:00.000Z",
    runScoped: false,
    ...overrides,
  };
}

function closedDialog(
  dialogId: string,
  title: string,
  reason: ClosedExtensionDialog["reason"],
  answer?: ClosedExtensionDialog["answer"],
): ClosedExtensionDialog {
  return {
    dialog: openDialog(dialogId, title),
    reason,
    ...(answer === undefined ? {} : { answer }),
  };
}
