// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { CommandLedgerEntry } from "../commandLedger";
import { ChatView } from "./ChatView";

/**
 * A slash command shows as a user bubble carrying the command, its result
 * beneath, and the delivery mark a sent message wears - the way pi's own TUI
 * shows a command inline and never as a transcript entry. Nothing on it can
 * be dismissed, and the mark never says Read for a command that only got
 * accepted.
 */

function row(patch: Partial<CommandLedgerEntry>): CommandLedgerEntry {
  return { id: "cmd-1", sessionKey: "m::s", text: "/session", source: "typed", state: "pending", issuedAt: 1, ...patch };
}

async function mount(commandLedger: CommandLedgerEntry[], streaming = false): Promise<ChatView> {
  const view = new ChatView();
  view.sessionId = "s";
  view.messages = [];
  view.commandLedger = commandLedger;
  if (streaming) Object.assign(view, { status: { isStreaming: true } });
  document.body.append(view);
  await view.updateComplete;
  return view;
}

function bubble(view: ChatView): Element {
  const found = view.renderRoot.querySelector("article.msg.user.command");
  if (found === null) throw new Error("no command bubble rendered");
  return found;
}

afterEach(() => { document.body.replaceChildren(); });

describe("a command renders as a user bubble with a delivery mark", () => {
  it("shows the command, its result and Read once it ran, with nothing to dismiss", async () => {
    const view = await mount([row({ state: "ok", resultText: "Session name: opus-b" })]);
    const article = bubble(view);

    expect(article.querySelector(".command-text")?.textContent).toBe("/session");
    expect(article.querySelector(".command-result")?.textContent).toBe("Session name: opus-b");
    expect(article.querySelector(".delivery-text")?.textContent).toBe("Read");
    expect(article.querySelector("button")).toBeNull();
  });

  it("reads Not sent with the refusal beneath when the daemon refused", async () => {
    const view = await mount([row({ state: "failed", resultText: "/new is not implemented in the web UI yet" })]);
    const article = bubble(view);

    expect(article.classList.contains("failed")).toBe(true);
    expect(article.querySelector(".delivery-text")?.textContent).toBe("Not sent");
    expect(article.querySelector(".command-result")?.textContent).toBe("/new is not implemented in the web UI yet");
  });

  it("reads Queued, never Read, for a command the daemon accepted but has not run", async () => {
    const view = await mount([row({ state: "accepted", resultText: "Runs after the current reply finishes." })], true);
    const article = bubble(view);

    expect(article.querySelector(".delivery-text")?.textContent).toBe("Queued");
    expect(article.querySelector(".command-result")?.textContent).toBe("Runs after the current reply finishes.");
  });

  it("renders no bubble at all when the ledger is empty", async () => {
    const view = await mount([]);

    expect(view.renderRoot.querySelector("article.msg.user.command")).toBeNull();
  });
});
