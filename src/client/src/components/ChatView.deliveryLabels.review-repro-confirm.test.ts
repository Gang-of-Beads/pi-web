// @vitest-environment happy-dom
/* eslint-disable @typescript-eslint/consistent-type-assertions -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */

import { afterEach, describe, expect, it } from "vitest";
import { chatDeliveryPresentation } from "./ChatView";
import { applyQueueToDelivery, removeDeliveryLine } from "../messageDelivery";
import { advancePendingPrompt, isNetworkFailure, loadPendingPrompts, savePendingPrompt, sessionsWithFailedSends } from "../pendingOutbox";
import { pendingPromptActions } from "../pendingPromptActions";
import { classifySubmission, handleOutcome, transportFactsFor } from "../messageLifecycle";
import { isRequestTimeout } from "../api/requestDeadline";
import { HttpError } from "../api/http";
import { settlementSentence } from "../../../shared/operationSettlement";
import { OUTGOING_EVENTS, OUTGOING_STATES, outgoingVerdict } from "../outgoingMessages";
import type { MessageDeliveryState } from "./shared";

/**
 * Lane "confirm": what a lost send is called, by whom, and whether the words
 * describe a fact the reader can act on.
 *
 * The owner's question - "after sending it went idle, is that a closed loop?" -
 * is answered here three ways: which answer counts as a confirmation, what the
 * bubble says when no answer came, and where a row can wait forever.
 */

afterEach(() => { localStorage.clear(); });

/** The predicate both call sites inline (PromptEditor.ts:1269, sessionController.ts:657). */
const isDefiniteRefusal = (value: unknown): boolean => !isNetworkFailure(value) && !isRequestTimeout(value);

const gatewayTimeout = new HttpError("Remote machine timeout (Remote machine response body timed out)", 504, "prod-8504");

describe("an answer that names no verdict", () => {
  it.fails("stays unverifiable instead of deleting the message", () => {
    const outcome = classifySubmission(gatewayTimeout, isDefiniteRefusal, transportFactsFor(gatewayTimeout, { isTimeout: false, linkOffline: false }));

    // The gateway's 504 is produced by machineProxyRoutes.ts:366 when the
    // *proxy* gave up reading the remote daemon's body - the remote may have
    // accepted the prompt and be running it. Treating it as a refusal
    // (handleOutcome) deletes the bubble, hands the words back to the composer,
    // and a resend carries a NEW clientMessageId, so the daemon's acceptance
    // ledger cannot dedupe it: the message runs twice.
    expect({ settlement: outcome.settlement.outcome, ...handleOutcome(outcome) })
      .toMatchObject({ settlement: "unverifiable", keepRow: true, restoreComposer: false, keepInOutbox: true });
  });

  it("is the same shape as the daemon's own refusal, so 4xx must stay a refusal", () => {
    const refused = new HttpError("Session not found", 404, "local");
    const outcome = classifySubmission(refused, isDefiniteRefusal, transportFactsFor(refused, { isTimeout: false, linkOffline: false }));
    expect({ settlement: outcome.settlement.outcome, ...handleOutcome(outcome) })
      .toMatchObject({ settlement: "refused", keepRow: false, restoreComposer: true });
  });
});

describe("the words for a message nobody answered for", () => {
  it.fails("does not claim it may be running when the bytes never left", () => {
    const offline = new TypeError("Failed to fetch");
    const outcome = classifySubmission(offline, isDefiniteRefusal, transportFactsFor(offline, { isTimeout: false, linkOffline: true }));
    const bubble = chatDeliveryPresentation({ clientMessageId: "cm-1", state: "unverifiable" });

    // The shared vocabulary already has the sentence for this settlement
    // ("Not sent: the link was down.") and the fact that proves it
    // (bytesHandedToTransport false, shared/operationSettlement.ts). The bubble
    // shows one word for both losses, so a message the client *knows* never left
    // reads "No answer yet - this may already be running".
    expect({
      settlement: outcome.settlement.outcome,
      bytesHandedToTransport: outcome.settlement.outcome === "unverifiable" ? outcome.settlement.bytesHandedToTransport : undefined,
      sharedSentence: settlementSentence(outcome.settlement),
      bubbleText: bubble.text,
    }).toMatchObject({ bubbleText: "Not sent" });
  });

  it.fails("is not called something else by the tray under the composer", () => {
    const bubble = chatDeliveryPresentation({ clientMessageId: "cm-1", state: "unverifiable" });
    const tray = pendingPromptActions("unsent");
    // Two vocabularies for one message: "No answer yet" has Retry/Discard on the
    // bubble, "Unsent" + Retry/Discard in the tray. settlementSentence was
    // written so "two surfaces cannot describe the same state differently".
    expect({ bubble: bubble.text, tray: tray.label }).toMatchObject({ bubble: tray.label });
  });

  it("gives the reader words for who is being waited on", () => {
    const bubble = chatDeliveryPresentation({ clientMessageId: "cm-1", state: "unverifiable" });
    expect({ text: bubble.text, label: bubble.label }).toMatchObject({ text: "No answer yet" });
  });
});

describe("one event, two records", () => {
  it.fails("records an expired deadline the same way as a dropped link", () => {
    savePendingPrompt("local:session-timeout", { text: "a", clientMessageId: "cm-timeout", at: new Date().toISOString() });
    savePendingPrompt("local:session-link", { text: "b", clientMessageId: "cm-link", at: new Date().toISOString() });

    // PromptEditor.ts:1272 is the only caller of advancePendingPrompt, with two
    // events for the one branch that keeps the entry. Both mean "nobody said
    // what happened"; both put the bubble at "unverifiable" - and only one of
    // them writes a state the rest of the client can read.
    advancePendingPrompt("local:session-timeout", "cm-timeout", "send-timeout");
    advancePendingPrompt("local:session-link", "cm-link", "send-refused-network");

    // Today: records [undefined] - a timed-out send leaves the record in the
    // table's initial "stored" state, so nothing downstream can read it - and
    // the session list marks only the link failure.
    expect({
      records: loadPendingPrompts("local:session-timeout").map((entry) => entry.state),
      markedInList: [...sessionsWithFailedSends()].sort(),
    }).toMatchObject({ records: ["unverified"], markedInList: ["session-link", "session-timeout"] });
  });
});

describe("two confirmations that disagree", () => {
  it.fails("does not delete a row the acceptance frame already proved the daemon owns", () => {
    const proven = { role: "user" as const, parts: [{ type: "text" as const, text: "hello" }], meta: { delivery: { clientMessageId: "cm-1", state: "queued" as const } } };
    // The frame says the daemon owns this prompt. A later, ambiguous HTTP answer
    // goes down the refusal branch in deliverPromptToSession
    // (sessionController.ts:669) and calls removeDeliveryLine with no look at
    // the mark - so the row and its outbox entry go, and the words land back in
    // the composer for a second send (a fresh id, so the ledger cannot dedupe).
    const after = removeDeliveryLine([proven], "cm-1");
    expect({ rows: after.length, delivery: after[0]?.meta?.delivery?.state }).toMatchObject({ rows: 1, delivery: "queued" });
  });
});

describe("an idle session is not a delivery", () => {
  it.fails("waits for the transcript before calling a queued message read", () => {
    const queued = { role: "user" as const, parts: [{ type: "text" as const, text: "hello" }], meta: { delivery: { clientMessageId: "cm-1", state: "queued" as const } } };
    // applyQueueToDelivery(messages, queued, runtimeIdle) - driven by every status
    // frame (sessionController.ts:2078). "The queue no longer holds it and the
    // session is idle" is an inference from an absence; the committed copy is the
    // fact, and carryDeliveryForward already promotes the row when it arrives.
    const after = applyQueueToDelivery([queued], [], true);
    expect({ state: after[0]?.meta?.delivery?.state }).toMatchObject({ state: "received" });
  });
});

describe("a record read back from storage", () => {
  it.fails("survives a state the table has no row for", () => {
    // Nothing validates the state on the way out of localStorage
    // (pendingOutbox.ts isPendingPrompt only asks for a string), and the table
    // lookup is unchecked (outgoingMessages.ts:131). A record written by another
    // build - or by the bubble's own word, "unverifiable" - makes
    // advancePendingPrompt throw inside the async send, where nothing catches it.
    savePendingPrompt("local:session-1", { text: "a", clientMessageId: "cm-1", state: "unverifiable" as never, at: new Date().toISOString() });
    const advanced = advancePendingPrompt("local:session-1", "cm-1", "send-timeout");
    expect({ advanced, state: loadPendingPrompts("local:session-1")[0]?.state }).toMatchObject({ state: "unverified" });
  });
});

describe("where a row can wait forever", () => {
  it.fails("spells the state it waits in the same way as the bubble does", () => {
    const deliveryStates: MessageDeliveryState[] = ["sending", "received", "queued", "delivered", "failed", "unverifiable"];
    // Two modules, one fact, two spellings: the outbox record says "unverified",
    // the delivery table and the bubble say "unverifiable". Nothing forces them
    // together, and the state the reader sees most (the bubble) is the one name
    // the outbox table cannot be asked about.
    const onlyInOutbox = (OUTGOING_STATES as string[]).filter((state) => !(deliveryStates as string[]).includes(state));
    const onlyInDelivery = (deliveryStates as string[]).filter((state) => !(OUTGOING_STATES as string[]).includes(state));
    expect({ onlyInOutbox, onlyInDelivery }).toMatchObject({ onlyInOutbox: [], onlyInDelivery: [] });
  });

  it("has no clock-driven exit, only a server fact or the reader", () => {
    const exits = OUTGOING_EVENTS.filter((event) => outgoingVerdict("unverified", event).kind !== "ignore");
    // Documents that the outbox table is fact-driven. The only re-ask of the
    // daemon about these identities is closeUnverifiedOperations
    // (sessionController.ts:2161), called from onReconnect alone
    // (sessionController.ts:431): with a healthy socket nothing asks
    // again, and a message the daemon never received has no fact left to arrive.
    expect(exits).toEqual(["send-accepted", "daemon-queued", "daemon-delivered", "seen-in-transcript", "retry", "discard", "scope-gone"]);
  });
});

describe("the label of a confirmation that is not a queue", () => {
  it.fails("does not read the same as a message a queue actually holds", () => {
    const byHttpAnswer = chatDeliveryPresentation({ clientMessageId: "cm-1", state: "received" });
    const byQueue = chatDeliveryPresentation({ clientMessageId: "cm-1", state: "queued" }, undefined);
    // "received" is the 2xx answer (deliverPromptToSession marks it before
    // returning); "queued" is a queue entry. A steer accepted into a running
    // turn is neither in a queue nor waiting for the next turn.
    expect({ received: byHttpAnswer.text, queued: byQueue.text }).toMatchObject({ received: "Queued" });
    expect(byHttpAnswer.text).not.toBe(byQueue.text);
  });
});
