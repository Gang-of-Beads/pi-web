// @vitest-environment happy-dom

import { beforeEach, describe, expect, it } from "vitest";
import "./ChatView";
import type { ChatView } from "./ChatView";
import type { PendingExtensionDialog, SessionStatus } from "../../../shared/apiTypes";

const goalDraft: PendingExtensionDialog = {
  dialogId: "dialog-1",
  kind: "confirm",
  title: "Confirm Goal Draft",
  message: "Start this goal?",
  askedAt: new Date().toISOString(),
  runScoped: false,
};

const idleStatus: SessionStatus = {
  sessionId: "session-1",
  model: { provider: "anthropic", id: "claude-opus-5" },
  isStreaming: false,
  isCompacting: false,
  isBashRunning: false,
  pendingMessageCount: 0,
  queuedMessages: [],
  tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  cost: 0,
};

async function mount(queued: readonly string[], dialogs: PendingExtensionDialog[]): Promise<ChatView> {
  document.body.innerHTML = "<chat-view></chat-view>";
  const view = document.body.querySelector<ChatView>("chat-view");
  if (view === null) throw new Error("chat view did not mount");
  view.messages = [];
  view.pendingDialogs = dialogs;
  view.status = { ...idleStatus, queuedMessages: queued.map((text) => ({ kind: "followUp" as const, text })) };
  view.onAnswerDialog = () => undefined;
  await view.updateComplete;
  return view;
}

function dialogCard(view: ChatView): Element | null {
  return view.renderRoot.querySelector("extension-dialog-card");
}

describe("a question the session is blocked on outranks the queue", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("renders the dialog when nothing is queued", async () => {
    const view = await mount([], [goalDraft]);
    expect(dialogCard(view)).not.toBeNull();
  });

  it("still renders the dialog when the queue has content", async () => {
    const view = await mount(["queued one", "queued two"], [goalDraft]);
    expect(dialogCard(view)).not.toBeNull();
  });

  it("renders no dialog card when there is no dialog", async () => {
    const view = await mount(["queued one"], []);
    expect(dialogCard(view)).toBeNull();
  });
});
