import { describe, expect, it } from "vitest";
import { ASK_USER_ANSWERS_CUSTOM_TYPE } from "../../../shared/apiTypes.js";
import { PiSessionService } from "./piSessionService.js";
import { PendingAskStore } from "./pendingAskStore.js";
import { CapturingSessionEventHub, emptyArchiveStore, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const SESSION_ID = "session-1";

/**
 * A running session whose fake pi keeps agent-core's two queues the way the SDK does: a custom
 * message sent while the agent runs waits in the queue its `deliverAs` names, and `clearQueue`
 * empties pi's lanes and both queues. `drain` is pi's agent loop polling the steering queue at an
 * injection point.
 */
async function runningSessionWithAnAnswer() {
  const store = new PendingAskStore({ now: () => new Date("2026-02-01T10:00:00.000Z"), createAskId: () => "ask-1" });
  const fake = fakeRuntime(SESSION_ID);
  const steering: unknown[] = [];
  const followUp: unknown[] = [];
  const queues = { steeringQueue: { messages: steering }, followUpQueue: { messages: followUp } };
  const agent = Object.assign(fake.session.agent, queues, { steer: (message: unknown) => { queues.steeringQueue.messages.push(message); } });
  fake.session.agent = agent;
  fake.session.isStreaming = true;
  fake.session.sendCustomMessage = (message, options) => {
    fake.calls.sendCustomMessage.push({ message, options });
    const lane = Reflect.get(Object(options), "deliverAs") === "followUp" ? queues.followUpQueue : queues.steeringQueue;
    if (fake.session.isStreaming && Reflect.get(Object(options), "triggerTurn") !== false) lane.messages.push({ role: "custom", ...message, timestamp: 1 });
    return Promise.resolve();
  };
  fake.session.clearQueue = () => {
    fake.calls.clearQueue += 1;
    queues.steeringQueue.messages = [];
    queues.followUpQueue.messages = [];
    return { steering: [], followUp: [] };
  };
  const service = new PiSessionService(new CapturingSessionEventHub(), {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    sessionManager: sessionGateway([sessionRecord(SESSION_ID)]),
    archiveStore: emptyArchiveStore(),
    createAgentRuntime: runtimeCreator(fake.runtime),
    pendingAskStore: store,
    askUserEnabled: true,
    heartbeatIntervalMs: 60_000,
  });
  await service.openAsk({ sessionId: SESSION_ID, questions: [{ id: "db", question: "Which database?", options: [{ value: "pg", label: "Postgres" }] }] });
  await service.submitAsk(sessionRef(SESSION_ID), "ask-1", { answers: [{ id: "db", values: ["pg"] }] });
  const queuedAskIds = async (): Promise<string[]> => ((await service.status(sessionRef(SESSION_ID))).queuedAnswers ?? []).map((outcome) => outcome.askId);
  const drain = (): void => { queues.steeringQueue.messages = []; };
  return { service, fake, queues, queuedAskIds, drain };
}

describe("an answer the agent has not read yet (B26)", () => {
  it("is on the status from the moment it is given until pi takes it", async () => {
    const { service, queuedAskIds, drain } = await runningSessionWithAnAnswer();

    const whileQueued = await queuedAskIds();
    drain();

    expect({ whileQueued, afterRead: await queuedAskIds() }).toEqual({ whileQueued: ["ask-1"], afterRead: [] });
    await service.dispose();
  });

  it("waits in the steering queue, not behind all the agent's remaining work", async () => {
    const { service, queues } = await runningSessionWithAnAnswer();

    expect({ steering: queues.steeringQueue.messages.length, followUp: queues.followUpQueue.messages.length }).toEqual({ steering: 1, followUp: 0 });
    await service.dispose();
  });

  it("stays queued when a recall empties pi's lanes", async () => {
    const { service, queuedAskIds } = await runningSessionWithAnAnswer();

    await service.recallQueuedMessage(sessionRef(SESSION_ID), { kind: "steer", text: "not queued anywhere" });

    expect(await queuedAskIds()).toEqual(["ask-1"]);
    await service.dispose();
  });

  it("is written into the transcript, without a run, when the reader stops the reply", async () => {
    const { service, fake, queuedAskIds } = await runningSessionWithAnAnswer();

    await service.abort(sessionRef(SESSION_ID));

    const written = fake.calls.sendCustomMessage.at(-1);
    expect({ type: written?.message.customType, options: written?.options, queued: await queuedAskIds() })
      .toEqual({ type: ASK_USER_ANSWERS_CUSTOM_TYPE, options: { triggerTurn: false }, queued: [] });
    await service.dispose();
  });

  it("is written into the transcript before the runtime closes", async () => {
    const { service, fake } = await runningSessionWithAnAnswer();

    await service.stop(sessionRef(SESSION_ID));

    const written = fake.calls.sendCustomMessage.at(-1);
    expect({ type: written?.message.customType, options: written?.options }).toEqual({ type: ASK_USER_ANSWERS_CUSTOM_TYPE, options: { triggerTurn: false } });
    await service.dispose();
  });
});
