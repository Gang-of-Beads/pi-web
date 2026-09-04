// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import type { PendingExtensionDialog } from "../api";
import type { ClosedExtensionDialog } from "../appState";
import { ChatView } from "./ChatView";
import type { ExtensionDialogCard } from "./ExtensionDialogCard";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * The owner tapped Dismiss on a settled extension-dialog card and the card was
 * still on screen afterwards, so he tapped again. These pin the two things that
 * would produce that: a dismissal that reports the wrong card, and a second
 * card taking the first one's place so the tap looks like it did nothing.
 *
 * An answered card no longer offers Dismiss at all: it collapses to a quiet
 * row the moment it settles (the owner chose that), and its durable record is
 * the notification the daemon filed in the drawer. Dismiss survives only on
 * cards that settled without an answer.
 */
describe("ChatView settled extension dialog dismissal", () => {
  it("renders an answered card as a row with no Dismiss to tap", async () => {
    const view = await mountView();
    const dismissed: string[] = [];
    view.onDismissClosedDialog = (dialogId: string) => { dismissed.push(dialogId); };
    view.closedDialogs = [closedDialog("dlg-a")];
    await view.updateComplete;

    const card = cardFor(view, "dlg-a");
    expect(card.shadowRoot?.querySelector(".answered-row")).not.toBeNull();
    expect([...(card.shadowRoot?.querySelectorAll("button") ?? [])]).toEqual([]);

    expect(dismissed).toEqual([]);
  });

  it("renders a cancelled card as a quiet row with no control to press", async () => {
    // Contract change, stated openly: the cancelled branch used to keep a live
    // Dismiss under a label that already said dismissed - reported by the
    // owner more than ten times. Settled is settled for every close reason.
    const view = await mountView();
    view.closedDialogs = [closedDialog("dlg-a"), cancelledDialog("dlg-b")];
    await view.updateComplete;

    const card = cardFor(view, "dlg-b");
    const buttons = [...(card.shadowRoot?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(0);
  });

  it("keeps each settled card bound to its own dialog id when one is removed", async () => {
    const view = await mountView();
    view.closedDialogs = [closedDialog("dlg-a"), closedDialog("dlg-b")];
    await view.updateComplete;

    view.closedDialogs = [closedDialog("dlg-b")];
    await view.updateComplete;

    const cards = [...(view.shadowRoot?.querySelectorAll("extension-dialog-card.closed-dialog-card") ?? [])];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.getAttribute("data-scroll-anchor-id")).toBe("closed-dialog:dlg-b");
  });
});

async function mountView(): Promise<ChatView> {
  const view = new ChatView();
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function closedDialog(dialogId: string): ClosedExtensionDialog {
  return {
    dialog: openDialog(dialogId, "Extension updates available: github.com/nicobailon/pi-subagents"),
    reason: "answered",
    answer: "Update now",
  };
}

function cancelledDialog(dialogId: string): ClosedExtensionDialog {
  return {
    dialog: openDialog(dialogId, "Extension updates available: github.com/nicobailon/pi-subagents"),
    reason: "cancelled",
  };
}

function openDialog(dialogId: string, title: string): PendingExtensionDialog {
  return { dialogId, title, kind: "confirm", options: ["Update now", "Skip"], askedAt: "2026-08-28T09:00:00.000Z", runScoped: false };
}

function cardFor(view: ChatView, dialogId: string): ExtensionDialogCard {
  const card = view.shadowRoot?.querySelector<ExtensionDialogCard>(`extension-dialog-card[data-scroll-anchor-id="closed-dialog:${dialogId}"]`);
  if (card === null || card === undefined) throw new Error(`No settled card rendered for ${dialogId}`);
  return card;
}

