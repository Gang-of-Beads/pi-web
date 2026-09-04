import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../../shared/apiTypes.js";
import { createPiWebCustomToolDefinitions, PiSessionService } from "./piSessionService.js";
import { PendingAskStore, PendingAskValidationError } from "./pendingAskStore.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";
const ACTIVE_SESSION_ID = "session-1";

const questions = [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }];

/**
 * Service over a clocked store with sequential ask ids, so asks are named
 * `ask-1`, `ask-2`, … and timestamps are fixed. Pass `withActiveSession` when the
 * test needs a live runtime to deliver answers into.
 */
function askService(options: { withActiveSession?: boolean } = {}) {
  const store = new PendingAskStore({
    now: () => new Date("2026-02-01T10:00:00.000Z"),
    createAskId: (() => {
      let next = 0;
      return () => { next += 1; return `ask-${next.toString()}`; };
    })(),
  });
  const fake = fakeRuntime(ACTIVE_SESSION_ID);
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    sessionManager: sessionGateway(options.withActiveSession === true ? [sessionRecord(ACTIVE_SESSION_ID)] : []),
    archiveStore: emptyArchiveStore(),
    ...(options.withActiveSession === true ? { createAgentRuntime: runtimeCreator(fake.runtime) } : {}),
    pendingAskStore: store,
    askUserEnabled: true,
    heartbeatIntervalMs: 60_000,
  });
  return { service, store, events, fake };
}

function askEvents(events: CapturingSessionEventHub) {
  return events.sessionEvents
    .filter(({ event }) => event.type === "ask.opened" || event.type === "ask.closed")
    .map(({ sessionId, event }) => ({ sessionId, event }));
}

/**
 * The ask frame minus its interactive-surface stamps. Shape assertions read
 * better without the stamps, whose sequence is asserted separately - both
 * halves together pin the full wire contract.
 */
function withoutStamps(event: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(event).filter(([key]) => key !== "revision" && key !== "daemonInstanceId"));
}

/** The surface-revision sequence the captured ask frames carry, in order. */
function askRevisions(events: CapturingSessionEventHub): unknown[] {
  return askEvents(events).map(({ event }) => {
    const revision: unknown = Reflect.get(event, "revision");
    return revision;
  });
}


describe("ask_user registration", () => {
  it("offers ask_user whenever the capability is configured, including to restricted tracked children", () => {
    const askUser = { open: vi.fn() };

    const unrestricted = createPiWebCustomToolDefinitions("/workspace", true, undefined, undefined, askUser);
    const restricted = createPiWebCustomToolDefinitions("/workspace", false, undefined, undefined, askUser);

    expect(unrestricted.map((definition) => definition.name)).toEqual(["edit", "ask_user"]);
    expect(restricted.map((definition) => definition.name)).toEqual(["edit", "ask_user"]);
  });

  it("omits ask_user when the capability is disabled", () => {
    const definitions = createPiWebCustomToolDefinitions("/workspace", true);

    expect(definitions.map((definition) => definition.name)).toEqual(["edit"]);
  });
});

describe("PiSessionService.openAsk", () => {
  it("registers the question set as the session's open ask", async () => {
    const { service, store } = askService();

    const result = await service.openAsk({ sessionId: "session-1", questions });

    expect(result.ask).toMatchObject({ askId: "ask-1", askedAt: "2026-02-01T10:00:00.000Z" });
    expect(result).not.toHaveProperty("superseded");
    expect(store.pendingAsk("session-1")).toMatchObject({ askId: "ask-1" });
    await service.dispose();
  });

  it("supersedes the session's earlier unanswered ask and reports its outcome", async () => {
    const { service, store } = askService();
    await service.openAsk({ sessionId: "session-1", questions });

    const result = await service.openAsk({ sessionId: "session-1", questions: [{ id: "again", question: "Still?", options: [] }] });

    expect(result.ask.askId).toBe("ask-2");
    expect(result.superseded).toMatchObject({ askId: "ask-1", reason: "superseded", answeredCount: 0, unansweredIds: ["db"] });
    expect(store.pendingAsk("session-1")).toMatchObject({ askId: "ask-2" });
    await service.dispose();
  });

  it("keeps asks of different sessions independent", async () => {
    const { service, store } = askService();

    await service.openAsk({ sessionId: "session-1", questions });
    const other = await service.openAsk({ sessionId: "session-2", questions });

    expect(other).not.toHaveProperty("superseded");
    expect(store.pendingAsk("session-1")).toMatchObject({ askId: "ask-1" });
    expect(store.pendingAsk("session-2")).toMatchObject({ askId: "ask-2" });
    await service.dispose();
  });

  it("opens an optionless question with a custom answer", async () => {
    const { service, store, events } = askService();

    const result = await service.openAsk({ sessionId: "session-1", questions: [{ id: "empty", question: "Anything else?", options: [] }] });

    expect(result.ask.questions).toEqual([{ id: "empty", question: "Anything else?", options: [] }]);
    expect(store.pendingAsk("session-1")).toEqual(result.ask);
    expect(askEvents(events)).toHaveLength(1);
    await service.dispose();
  });

  it("publishes ask.opened so a watching browser renders the card without refetching status", async () => {
    const { service, events } = askService();

    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    // Ask frames carry the interactive-surface revision (shared with dialogs)
    // so the lost-frame repair can compare stamps; the daemon identity rides
    // along for restart detection.
    expect(askEvents(events).map(({ sessionId, event }) => ({ sessionId, event: withoutStamps(event) }))).toEqual([
      { sessionId: ACTIVE_SESSION_ID, event: { type: "ask.opened", ask: { askId: "ask-1", askedAt: "2026-02-01T10:00:00.000Z", questions } } },
    ]);
    expect(askRevisions(events)).toEqual([1]);
    await service.dispose();
  });

  it("publishes the supersede as a close before the replacement opens", async () => {
    const { service, events } = askService();
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions: [{ id: "again", question: "Still?", options: [] }] });

    expect(askEvents(events).map(({ event }) => withoutStamps(event))).toEqual([
      { type: "ask.opened", ask: { askId: "ask-1", askedAt: "2026-02-01T10:00:00.000Z", questions } },
      { type: "ask.closed", askId: "ask-1", reason: "superseded" },
      { type: "ask.opened", ask: { askId: "ask-2", askedAt: "2026-02-01T10:00:00.000Z", questions: [{ id: "again", question: "Still?", options: [] }] } },
    ]);
    expect(askRevisions(events)).toEqual([1, 2, 3]);
    await service.dispose();
  });
});

describe("PiSessionService ask status projection", () => {
  it("reports the open ask in status so a reloading browser rehydrates it", async () => {
    const { service } = askService({ withActiveSession: true });

    const before = await service.status(sessionRef(ACTIVE_SESSION_ID));
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });
    const during = await service.status(sessionRef(ACTIVE_SESSION_ID));
    await service.submitAsk(sessionRef(ACTIVE_SESSION_ID), "ask-1", { answers: [{ id: "db", values: ["pg"] }] });
    const after = await service.status(sessionRef(ACTIVE_SESSION_ID));

    expect(before).not.toHaveProperty("pendingAsk");
    expect(during.pendingAsk).toMatchObject({ askId: "ask-1", questions });
    expect(after).not.toHaveProperty("pendingAsk");
    await service.dispose();
  });

  it("drops the open ask when the runtime that posted it is closed", async () => {
    const { service, store } = askService({ withActiveSession: true });
    await service.status(sessionRef(ACTIVE_SESSION_ID));
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    await service.stop(sessionRef(ACTIVE_SESSION_ID));

    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeUndefined();
    await service.dispose();
  });
});

describe("PiSessionService.submitAsk", () => {
  it("delivers a custom answer as a follow-up message that wakes the session", async () => {
    const { service, store, events, fake } = askService({ withActiveSession: true });
    await service.openAsk({
      sessionId: ACTIVE_SESSION_ID,
      questions: [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }],
    });

    const response = await service.submitAsk(sessionRef(ACTIVE_SESSION_ID), "ask-1", {
      answers: [{ id: "db", values: [], otherText: "DuckDB" }],
    });

    expect(response).toMatchObject({ result: "closed", outcome: { askId: "ask-1", reason: "submitted", answeredCount: 1, unansweredIds: [] } });
    expect(response.sessionStatus.sessionId).toBe(ACTIVE_SESSION_ID);
    expect(fake.calls.sendCustomMessage).toHaveLength(1);
    const [delivered] = fake.calls.sendCustomMessage;
    expect(delivered?.message.customType).toBe(ASK_USER_ANSWERS_CUSTOM_TYPE);
    expect(delivered?.message.display).toBe(true);
    expect(delivered?.message.content).toContain("The user submitted answers to your questions.");
    expect(delivered?.message.content).toContain(`custom: "DuckDB"`);
    expect(delivered?.message.content).toContain("Answered 1 of 1");
    expect(delivered?.message.details).toMatchObject({ askId: "ask-1", reason: "submitted" });
    expect(delivered?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
    expect(askEvents(events).map(({ event }) => event.type)).toEqual(["ask.opened", "ask.closed"]);
    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeUndefined();
    await service.dispose();
  });

  it("names the questions the user left unanswered in the message the model reads", async () => {
    const { service, fake } = askService({ withActiveSession: true });
    await service.openAsk({
      sessionId: ACTIVE_SESSION_ID,
      questions: [...questions, { id: "cache", question: "Which cache?", options: [{ value: "redis", label: "Redis" }] }],
    });

    const response = await service.submitAsk(sessionRef(ACTIVE_SESSION_ID), "ask-1", { answers: [{ id: "db", values: ["pg"] }] });

    expect(response.outcome).toMatchObject({ answeredCount: 1, unansweredIds: ["cache"] });
    expect(fake.calls.sendCustomMessage[0]?.message.content).toContain("Answered 1 of 2; unanswered: cache");
    await service.dispose();
  });

  it("reports a stale ask id without delivering anything or closing the open ask", async () => {
    const { service, store, events, fake } = askService({ withActiveSession: true });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    const response = await service.submitAsk(sessionRef(ACTIVE_SESSION_ID), "ask-superseded", { answers: [] });

    expect(response.result).toBe("stale");
    expect(response).not.toHaveProperty("outcome");
    expect(response.sessionStatus.pendingAsk).toMatchObject({ askId: "ask-1" });
    expect(fake.calls.sendCustomMessage).toEqual([]);
    expect(askEvents(events).map(({ event }) => event.type)).toEqual(["ask.opened"]);
    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toMatchObject({ askId: "ask-1" });
    await service.dispose();
  });

  it("leaves the ask open when the submitted answers do not fit its questions", async () => {
    const { service, store, fake } = askService({ withActiveSession: true });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    await expect(service.submitAsk(sessionRef(ACTIVE_SESSION_ID), "ask-1", { answers: [{ id: "nope", values: [] }] }))
      .rejects.toThrow(PendingAskValidationError);

    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toMatchObject({ askId: "ask-1" });
    expect(fake.calls.sendCustomMessage).toEqual([]);
    await service.dispose();
  });
});

describe("PiSessionService.prompt with an open ask", () => {
  // A chat message is an addition, not a withdrawal: every question carries a
  // Custom answer, so a remark alongside the form leaves the questions
  // answerable. Closing them on it discarded three questions the reader never
  // withdrew, and the reply then asked for answers they had been made unable to
  // give (owner's ruling, 2026-09-03).
  it("leaves the open ask answerable and sends the message", async () => {
    const { service, store, events, fake } = askService({ withActiveSession: true });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    await service.prompt(sessionRef(ACTIVE_SESSION_ID), "Use DuckDB");

    expect(store.pendingAsk(ACTIVE_SESSION_ID)?.askId).toBe("ask-1");
    expect(askEvents(events).map(({ event }) => withoutStamps(event))).toEqual([
      { type: "ask.opened", ask: { askId: "ask-1", askedAt: "2026-02-01T10:00:00.000Z", questions } },
    ]);
    expect(askRevisions(events)).toEqual([1]);
    expect(fake.calls.sendCustomMessage).toEqual([]);
    expect(fake.calls.prompt.map((call) => call.text)).toEqual(["Use DuckDB"]);
    await service.dispose();
  });

  // The failure this covers, observed 2026-08-24: a message queued before
  // `ask_user` ran was delivered by the agent six milliseconds after the form
  // appeared, because the ask is what ends the run. Nothing voided the ask, so
  // the reader kept a live form on screen while the model read the queued
  // message and reported the questions unanswered.
  it("voids the open ask when a message queued earlier is delivered", async () => {
    const { service, store, events, fake } = askService({ withActiveSession: true });
    // Opens the runtime, which is what subscribes to its events.
    await service.status(sessionRef(ACTIVE_SESSION_ID));
    // The message is already waiting in the runtime's queue when the ask
    // opens - that order is the whole point: the questions were posted by a
    // run that had not seen it.
    fake.session.getFollowUpMessages = () => ["queued before the questions"];
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });
    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeDefined();

    fake.emit({ type: "message_start", message: { role: "user", content: "queued before the questions" } });
    await vi.waitFor(() => { expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeUndefined(); });

    expect(askEvents(events).map(({ event }) => withoutStamps(event))).toEqual([
      { type: "ask.opened", ask: { askId: "ask-1", askedAt: "2026-02-01T10:00:00.000Z", questions } },
      { type: "ask.closed", askId: "ask-1", reason: "cancelled" },
    ]);
    expect(askRevisions(events)).toEqual([1, 2]);
    const [delivered] = fake.calls.sendCustomMessage;
    expect(delivered?.message.content).toContain("unanswered: db");
    expect(delivered?.options).toEqual({ triggerTurn: false, deliverAs: "followUp" });
    await service.dispose();
  });

  // The owner's ruling: a chat message beside the form is an addition to the
  // request, not a refusal of it - every question carries a Custom answer. The
  // acceptance path honoured that, but when the same message drained from the
  // queue and committed, the delivered-event path voided the ask anyway: the
  // sibling producer of the same closed form, caught live on 2026-09-04.
  it("keeps the ask open when a message sent in its presence is delivered", async () => {
    const { service, store, fake } = askService({ withActiveSession: true });
    await service.status(sessionRef(ACTIVE_SESSION_ID));
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    fake.emit({ type: "message_start", message: { role: "user", content: "and also support sqlite" } });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(store.pendingAsk(ACTIVE_SESSION_ID)?.askId).toBe("ask-1");
    expect(fake.calls.sendCustomMessage).toEqual([]);
    await service.dispose();
  });

  // Review findings, all three directions of the id key: texts drift under
  // template expansion, captionless photos have no text at all, and a text
  // collision must never void the form for a remark that carries its own id.
  it("voids for a captionless pre-ask photo, by id", async () => {
    const { service, store, fake } = askService({ withActiveSession: true });
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-ask-photo-"));
    fake.session.sessionManager.getCwd = () => cwd;
    Reflect.set(fake.runtime, "cwd", cwd);
    const ref = sessionRef(ACTIVE_SESSION_ID, cwd);
    await service.status(ref);
    fake.session.isStreaming = true;
    await service.prompt(ref, "", "followUp", undefined, { clientMessageId: "c-photo" });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    fake.emit({ type: "message_start", message: { role: "user", clientMessageId: "c-photo", content: [{ type: "image", mimeType: "image/png", data: "AAAA" }] } });
    await vi.waitFor(() => { expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeUndefined(); });
    await service.dispose();
  });

  it("voids for a pre-ask prompt the runtime rewrote, by id", async () => {
    const { service, store, fake } = askService({ withActiveSession: true });
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-ask-template-"));
    fake.session.sessionManager.getCwd = () => cwd;
    Reflect.set(fake.runtime, "cwd", cwd);
    const ref = sessionRef(ACTIVE_SESSION_ID, cwd);
    await service.status(ref);
    fake.session.isStreaming = true;
    await service.prompt(ref, "/skill review", "followUp", undefined, { clientMessageId: "c-template" });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    fake.emit({ type: "message_start", message: { role: "user", clientMessageId: "c-template", content: "the expanded skill body" } });
    await vi.waitFor(() => { expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeUndefined(); });
    await service.dispose();
  });

  it("never voids for a remark whose words collide with the pre-ask queue", async () => {
    const { service, store, fake } = askService({ withActiveSession: true });
    const cwd = await mkdtemp(join(tmpdir(), "pi-web-ask-collision-"));
    fake.session.sessionManager.getCwd = () => cwd;
    Reflect.set(fake.runtime, "cwd", cwd);
    const ref = sessionRef(ACTIVE_SESSION_ID, cwd);
    await service.status(ref);
    fake.session.isStreaming = true;
    await service.prompt(ref, "continue", "followUp", undefined, { clientMessageId: "c-old" });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    fake.emit({ type: "message_start", message: { role: "user", clientMessageId: "c-new", content: "continue" } });
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(store.pendingAsk(ACTIVE_SESSION_ID)?.askId).toBe("ask-1");
    await service.dispose();
  });

  it("leaves an assistant message alone", async () => {
    const { service, store, fake } = askService({ withActiveSession: true });
    await service.status(sessionRef(ACTIVE_SESSION_ID));
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    fake.emit({ type: "message_start", message: { role: "assistant", content: "still working" } });
    await Promise.resolve();

    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeDefined();
    expect(fake.calls.sendCustomMessage).toEqual([]);
    await service.dispose();
  });

  it("sends a plain message untouched when no ask is open", async () => {
    const { service, events, fake } = askService({ withActiveSession: true });

    await service.prompt(sessionRef(ACTIVE_SESSION_ID), "hello");

    expect(fake.calls.sendCustomMessage).toEqual([]);
    expect(fake.calls.prompt.map((call) => call.text)).toEqual(["hello"]);
    expect(askEvents(events)).toEqual([]);
    await service.dispose();
  });
});

describe("PiSessionService.cancelAsk", () => {
  it("tells the model every question went unanswered rather than leaving it waiting", async () => {
    const { service, store, events, fake } = askService({ withActiveSession: true });
    await service.openAsk({ sessionId: ACTIVE_SESSION_ID, questions });

    const response = await service.cancelAsk(sessionRef(ACTIVE_SESSION_ID), "ask-1");

    expect(response).toMatchObject({ result: "closed", outcome: { reason: "cancelled", answeredCount: 0, unansweredIds: ["db"] } });
    expect(fake.calls.sendCustomMessage[0]?.message.content).toContain("closed (cancelled) before it was fully answered");
    expect(fake.calls.sendCustomMessage[0]?.options).toEqual({ triggerTurn: true, deliverAs: "followUp" });
    const lastAsk = askEvents(events).at(-1)?.event;
    expect(lastAsk === undefined ? undefined : withoutStamps(lastAsk)).toEqual({ type: "ask.closed", askId: "ask-1", reason: "cancelled" });
    expect(store.pendingAsk(ACTIVE_SESSION_ID)).toBeUndefined();
    await service.dispose();
  });

  it("reports a stale cancel of an ask that is already gone", async () => {
    const { service, fake } = askService({ withActiveSession: true });

    const response = await service.cancelAsk(sessionRef(ACTIVE_SESSION_ID), "ask-1");

    expect(response.result).toBe("stale");
    expect(fake.calls.sendCustomMessage).toEqual([]);
    await service.dispose();
  });

  /**
   * D7: acceptance is a sequenced fact. The frame tells the client the daemon
   * owns this prompt (sending → queued-server) and rides the per-session ring,
   * so a lost HTTP response or a lost frame is repaired by replay.
   */
  it("publishes prompt.accepted with the sender's clientMessageId", async () => {
    const { service, events } = askService({ withActiveSession: true });

    await service.prompt(sessionRef(ACTIVE_SESSION_ID), "hello", undefined, undefined, { clientMessageId: "cmid-d7" });

    const accepted = events.sessionEvents.filter(({ event }) => event.type === "prompt.accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.event).toMatchObject({ type: "prompt.accepted", clientMessageId: "cmid-d7" });
    await service.dispose();
  });
});
