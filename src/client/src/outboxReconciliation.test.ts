// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { forgetPendingPrompt, loadPendingPrompts, savePendingPrompt, OUTBOX_CHANGED_EVENT } from "./pendingOutbox";

/**
 * Owner report: a message the agent had already answered still offered
 * "Unsent · Retry". The send call reported a failure that raced an accepted
 * request, and nothing retired the outbox entry afterwards, because the
 * writer that learns of the acceptance is not the composer that renders it.
 */
describe("the outbox announces its own changes", () => {
  it("tells listeners which session changed when an entry is retired", () => {
    const key = "local|session-1";
    savePendingPrompt(key, { text: "hello", clientMessageId: "cm-1", at: new Date().toISOString() });
    const seen: unknown[] = [];
    const listener = (event: Event) => { seen.push(event instanceof CustomEvent ? event.detail : undefined); };
    window.addEventListener(OUTBOX_CHANGED_EVENT, listener);

    forgetPendingPrompt(key, "cm-1");

    window.removeEventListener(OUTBOX_CHANGED_EVENT, listener);
    expect(seen).toContain(key);
    expect(loadPendingPrompts(key)).toEqual([]);
  });

  it("leaves another session's entries alone", () => {
    savePendingPrompt("local|session-a", { text: "a", clientMessageId: "cm-a", at: new Date().toISOString() });
    savePendingPrompt("local|session-b", { text: "b", clientMessageId: "cm-b", at: new Date().toISOString() });

    forgetPendingPrompt("local|session-a", "cm-a");

    expect(loadPendingPrompts("local|session-a")).toEqual([]);
    expect(loadPendingPrompts("local|session-b").map((entry) => entry.clientMessageId)).toEqual(["cm-b"]);
  });
});
