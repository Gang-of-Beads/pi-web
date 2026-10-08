import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { OwnedPromptQueue, dataDirInboxLocation } from "./ownedPromptQueue.js";
import { CapturingSessionEventHub, fakeRuntime, fakeSessionManager, handedAs, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Pins the fixes from the phase 1 review of the daemon inbox (docs/design/state-sync-redesign.md,
 * "Phase 1 review triage"). The fake runtime here keeps a real steering lane, removes a steer
 * from it when the agent reads it, and calls preflight the way the SDK does.
 */
interface PromptOptions { streamingBehavior?: "steer" | "followUp"; preflightResult?: (disposition: "queued" | "started" | "handled") => void }

/**
 * `isCompacting` parks messages in the inbox while the agent runs: a running agent alone takes each
 * one into pi's lane at once (B33), so tests of what waits in the inbox park through a compaction.
 */
async function inboxService(sessionId: string, options: { dataDir?: string; dir?: string; isStreaming?: boolean; isCompacting?: boolean } = {}) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), "inbox-review-"));
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), "inbox-review-data-"));
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, { isStreaming: options.isStreaming ?? true, isCompacting: options.isCompacting ?? false });
  Reflect.set(fake.runtime, "cwd", dir);
  fake.session.sessionManager.getCwd = () => dir;
  const lane: string[] = [];
  const reportLane = () => { fake.emit({ type: "queue_update", steering: [...lane], followUp: [] }); };
  const pushLane = lane.push.bind(lane);
  Object.defineProperty(lane, "push", {
    enumerable: false,
    value: (...texts: string[]) => {
      const size = pushLane(...texts);
      reportLane();
      return size;
    },
  });
  fake.session.getSteeringMessages = () => [...lane];
  fake.session.steer = (text: string) => {
    fake.calls.steer.push({ text });
    lane.push(text);
    return Promise.resolve();
  };
  fake.session.clearQueue = () => {
    fake.calls.clearQueue += 1;
    const steering = [...lane];
    lane.length = 0;
    reportLane();
    return { steering, followUp: [] };
  };
  fake.session.prompt = (text: string, promptOptions?: PromptOptions) => {
    fake.calls.prompt.push({ text, options: promptOptions });
    if (promptOptions?.streamingBehavior === "steer" && fake.session.isStreaming) lane.push(text);
    const commandName = text.startsWith("/") ? text.slice(1).split(" ", 1)[0] : undefined;
    const handled = commandName !== undefined && fake.session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === commandName);
    promptOptions?.preflightResult?.(handled ? "handled" : promptOptions.streamingBehavior === "steer" && fake.session.isStreaming ? "queued" : "started");
    return Promise.resolve();
  };
  const service = new PiSessionService(hub, {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId, dir)]),
    heartbeatIntervalMs: 60_000,
    operationLedgerDir: dataDir,
  });
  const ref = sessionRef(sessionId, dir);
  const readSteer = (committedText: string) => {
    lane.shift();
    reportLane();
    fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: committedText }] } });
  };
  return { hub, fake, service, ref, dir, dataDir, lane, readSteer };
}

const texts = (calls: { text: string }[]) => calls.map((call) => call.text);

/**
 * Model the agent loop having drained agent-core's queues at its poll: pi still shows the lane
 * entries (it removes them only at `message_start`), but agent-core holds no user messages.
 * Custom messages (ask answers, subsession notices) may remain queued.
 */
function drainAgentQueues(agent: object, remaining: { steer?: unknown[]; followUp?: unknown[] } = {}, mode: "all" | "one-at-a-time" = "all"): void {
  Reflect.set(agent, "steeringQueue", agentQueue(remaining.steer ?? [], mode));
  Reflect.set(agent, "followUpQueue", agentQueue(remaining.followUp ?? [], mode));
}

/** agent-core's PendingMessageQueue shape: `messages` is the queue, `peek()` the next drain. */
function agentQueue(messages: unknown[], mode: "all" | "one-at-a-time") {
  return { messages, peek: () => mode === "all" ? [...messages] : messages.slice(0, 1) };
}

describe("the inbox settles each message from what the agent did (O1)", () => {
  it("settles a steer the agent read under other text, so a retry after a restart does not run it again", async () => {
    const first = await inboxService("o1-steer");
    await first.service.prompt(first.ref, "look at this", undefined, undefined, { clientMessageId: "o1-s-0001" });
    first.fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(first.lane).toEqual(["look at this"]); });
    first.readSteer("look at this\n\n[Image resized to 1568x1176]");
    expect(first.service.operationOutcomes("o1-steer", ["o1-s-0001"])).toEqual({ "o1-s-0001": "succeeded" });
    await first.service.dispose();

    const second = await inboxService("o1-steer", { dir: first.dir, dataDir: first.dataDir, isStreaming: false });
    await second.service.prompt(second.ref, "look at this", undefined, undefined, { clientMessageId: "o1-s-0001" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(second.fake.calls.prompt).toHaveLength(0);
    await second.service.dispose();
  });

  it("settles a direct prompt once its run starts reading it, whatever text it commits under", async () => {
    const { fake, service, ref } = await inboxService("o1-direct", { isStreaming: false });
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      options?.preflightResult?.("started");
      fake.session.isStreaming = true;
      fake.emit({ type: "agent_start" });
      fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: `${text}\n\n[hint]` }] } });
      return new Promise<void>(() => undefined);
    };
    await service.prompt(ref, "hello", undefined, undefined, { clientMessageId: "o1-d-0001" });
    await vi.waitFor(() => { expect(service.operationOutcomes("o1-direct", ["o1-d-0001"])).toEqual({ "o1-d-0001": "succeeded" }); });
    await service.dispose();
  });

  it("leaves a steer still in pi's queue pending, so a restart that loses it lets the retry run", async () => {
    const { fake, service, ref, lane } = await inboxService("o1-held");
    await service.prompt(ref, "held", undefined, undefined, { clientMessageId: "o1-h-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["held"]); });
    fake.emit({ type: "message_start", message: { role: "user", content: "someone else's message" } });
    expect(service.operationOutcomes("o1-held", ["o1-h-0001"])).toEqual({ "o1-h-0001": "pending" });
    await service.dispose();
  });
});

describe("nothing is handed while a run is settling (O2)", () => {
  it("waits for agent_settled after the run flag drops, then hands a stranded steer before a newer message", async () => {
    const { fake, service, ref, lane } = await inboxService("o2-settle");
    await service.status(ref);
    fake.emit({ type: "agent_start" });
    await service.prompt(ref, "S stranded", undefined, undefined, { clientMessageId: "o2-s-0001" });
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["S stranded"]); });
    fake.session.isStreaming = false;
    const handToIdle = fake.session.prompt.bind(fake.session);
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      await handToIdle(text, options);
      if (options?.streamingBehavior === undefined) fake.session.isStreaming = true;
    };
    await service.prompt(ref, "A newer", undefined, undefined, { clientMessageId: "o2-a-0001" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts(fake.calls.prompt)).toEqual(["S stranded"]);

    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["S stranded", "S stranded"]); });
    expect(fake.calls.prompt.map(handedAs)).toEqual(["steer", undefined]);
    expect(texts(fake.calls.steer)).toEqual(["A newer"]);
    await service.dispose();
  });
});

/**
 * The idle injection point (D1, B33): messages that waited for a run reach the model in one
 * request. The oldest starts the run and the rest are queued behind it in pi's lane, which the
 * run reads at its first poll. The fake stands in for pi: a direct prompt starts a run.
 */
describe("the idle batch (B33)", () => {
  async function waitedThroughARun(sessionId: string, messages: readonly string[]) {
    const setup = await inboxService(sessionId, { isCompacting: true });
    const { fake, service, ref } = setup;
    const handToIdle = fake.session.prompt.bind(fake.session);
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      await handToIdle(text, options);
      if (options?.streamingBehavior === undefined) fake.session.isStreaming = true;
    };
    for (const [index, text] of messages.entries()) await service.prompt(ref, text, undefined, undefined, { clientMessageId: `${sessionId}-${String(index)}` });
    return setup;
  }
  const endRun = (fake: ReturnType<typeof fakeRuntime>) => {
    fake.session.isStreaming = false;
    fake.session.isCompacting = false;
    fake.emit({ type: "agent_settled" });
  };
  const queuedTexts = async (service: PiSessionService, ref: ReturnType<typeof sessionRef>) => (await service.status(ref)).queuedMessages.map((entry) => entry.text);

  it("starts the run with the oldest and queues the rest behind it, in order", async () => {
    const { fake, service, ref, lane } = await waitedThroughARun("idle-batch", ["A", "B", "C"]);
    endRun(fake);
    await vi.waitFor(() => { expect(lane).toEqual(["B", "C"]); });
    expect({ prompted: texts(fake.calls.prompt), queuedBehind: texts(fake.calls.steer) }).toEqual({ prompted: ["A"], queuedBehind: ["B", "C"] });
    expect(await queuedTexts(service, ref)).toEqual(["B", "C"]);
    await service.dispose();
  });

  it("takes the queued ones back when the oldest is refused, and keeps the order for the next try", async () => {
    const { fake, service, ref, lane } = await waitedThroughARun("idle-refused", ["A", "B", "C"]);
    const handToIdle = fake.session.prompt.bind(fake.session);
    let refuse = true;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      if (!refuse) return handToIdle(text, options);
      refuse = false;
      fake.calls.prompt.push({ text, options });
      return Promise.reject(new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."));
    };
    endRun(fake);
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A"]); });
    await vi.waitFor(async () => { expect(await queuedTexts(service, ref)).toEqual(["A", "B", "C"]); });
    expect(lane).toEqual([]);
    expect(service.operationOutcomes("idle-refused", ["idle-refused-0", "idle-refused-1", "idle-refused-2"])).toEqual({ "idle-refused-0": "pending", "idle-refused-1": "pending", "idle-refused-2": "pending" });

    endRun(fake);
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A", "A"]); });
    expect({ queuedBehind: texts(fake.calls.steer), lane }).toEqual({ queuedBehind: ["B", "C", "B", "C"], lane: ["B", "C"] });
    await service.dispose();
  });

  it("ends the batch at the first extension command, which waits its own turn", async () => {
    const { fake, service } = await waitedThroughARun("idle-command", ["A", "B", "/kickoff", "C"]);
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "kickoff" }];
    endRun(fake);
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A", "/kickoff", "C"]); });

    expect({ batch: { started: fake.calls.prompt[0]?.text, queuedBehind: texts(fake.calls.steer) }, afterTheRunStarted: fake.calls.prompt.slice(1).map((call) => [call.text, handedAs(call)]) }).toEqual({
      batch: { started: "A", queuedBehind: ["B"] },
      afterTheRunStarted: [["/kickoff", "steer"], ["C", "steer"]],
    });
    await service.dispose();
  });

  it("lets Clear wait for the batch being queued, so no message lands after the queues were emptied", async () => {
    const { fake, service, ref, lane } = await waitedThroughARun("idle-clear", ["A", "B", "C"]);
    let release = (): void => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    fake.session.steer = async (text: string) => {
      fake.calls.steer.push({ text });
      if (text === "B") await held;
      lane.push(text);
    };
    endRun(fake);
    await vi.waitFor(() => { expect(texts(fake.calls.steer)).toEqual(["B"]); });
    const cleared = service.clearQueue(ref);
    await new Promise((resolve) => setTimeout(resolve, 40));
    release();
    await cleared;
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A"]); });
    expect({ lane, queued: await queuedTexts(service, ref) }).toEqual({ lane: [], queued: [] });
    expect(service.operationOutcomes("idle-clear", ["idle-clear-1", "idle-clear-2"])).toEqual({ "idle-clear-1": "withdrawn", "idle-clear-2": "withdrawn" });
    await service.dispose();
  });

  it("keeps the queued ones in the inbox file when the session closes while the oldest is still in preflight", async () => {
    const { fake, service, ref, lane, dir, dataDir } = await waitedThroughARun("idle-teardown", ["A", "B", "C"]);
    let endPreflight = (): void => undefined;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      return new Promise<void>((_resolve, reject) => { endPreflight = () => { reject(new Error("session disposed")); }; });
    };
    endRun(fake);
    await vi.waitFor(() => { expect({ lane, prompted: texts(fake.calls.prompt) }).toEqual({ lane: ["B", "C"], prompted: ["A"] }); });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const closed = service.stop(ref);
      await vi.advanceTimersByTimeAsync(5_100);
      vi.useRealTimers();
      endPreflight();
      await closed;
    } finally {
      vi.useRealTimers();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    const kept = await new OwnedPromptQueue(dataDirInboxLocation(dataDir)).open("idle-teardown", dir);
    expect(kept.map((entry) => entry.text)).toEqual(["B", "C"]);
    expect(service.operationOutcomes("idle-teardown", ["idle-teardown-0", "idle-teardown-1", "idle-teardown-2"])).toEqual({ "idle-teardown-0": "failed", "idle-teardown-1": "pending", "idle-teardown-2": "pending" });
    await service.dispose();
  });

  it("puts a message pi refuses to queue back, with everything after it, and still starts the run; the running agent then takes them in order", async () => {
    const { fake, service, ref, lane, dir, dataDir } = await waitedThroughARun("idle-steer-refused", ["A", "B", "C"]);
    fake.session.steer = (text: string) => {
      fake.calls.steer.push({ text });
      return Promise.reject(new Error("Extension commands cannot be queued"));
    };
    endRun(fake);
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A", "B", "C"]); });
    expect({ refusedAhead: texts(fake.calls.steer), afterTheRunStarted: fake.calls.prompt.slice(1).map((call) => [call.text, handedAs(call)]) }).toEqual({
      refusedAhead: ["B"],
      afterTheRunStarted: [["B", "steer"], ["C", "steer"]],
    });
    expect(await queuedTexts(service, ref)).toEqual(["B", "C"]);
    expect(lane).toEqual(["B", "C"]);
    const reopened = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    await vi.waitFor(async () => {
      const waiting = (await reopened.open("idle-steer-refused", dir)).map((entry) => entry.text);
      expect({ waiting, handed: reopened.handed("idle-steer-refused").map((entry) => entry.text) }).toEqual({ waiting: [], handed: ["B", "C"] });
    });
    expect(service.operationOutcomes("idle-steer-refused", ["idle-steer-refused-1", "idle-steer-refused-2"])).toEqual({ "idle-steer-refused-1": "pending", "idle-steer-refused-2": "pending" });
    await service.dispose();
  });
});

describe("the handed list follows every way a message leaves pi (B33)", () => {
  const handedTexts = (service: PiSessionService, sessionId: string): unknown[] => {
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    return queue.handed(sessionId).map((entry) => entry.text);
  };
  const handedIds = (service: PiSessionService, sessionId: string): unknown[] => {
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    return queue.handed(sessionId).map((entry) => entry.clientMessageId);
  };

  it("keeps a message accepted while the agent runs in the handed list until pi reads it", async () => {
    const { service, ref, lane, readSteer } = await inboxService("handed-read");
    await service.prompt(ref, "read me", undefined, undefined, { clientMessageId: "handed-read-01" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["read me"]); });
    const whileInLane = handedIds(service, "handed-read");

    readSteer("read me");
    await vi.waitFor(() => { expect(handedIds(service, "handed-read")).toEqual([]); });
    expect({ whileInLane, outcome: service.operationOutcomes("handed-read", ["handed-read-01"]) }).toEqual({ whileInLane: ["handed-read-01"], outcome: { "handed-read-01": "succeeded" } });
    await service.dispose();
  });

  it("forgets a message recalled out of pi's lane", async () => {
    const { service, ref, lane } = await inboxService("handed-recall");
    await service.prompt(ref, "take me back", undefined, undefined, { clientMessageId: "handed-recall-01" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["take me back"]); });

    const recalled = await service.recallQueuedMessage(ref, { kind: "steer", text: "take me back", clientMessageId: "handed-recall-01" });

    await vi.waitFor(() => { expect(handedIds(service, "handed-recall")).toEqual([]); });
    expect({ recalled: recalled.recalled, lane: [...lane] }).toEqual({ recalled: true, lane: [] });
    await service.dispose();
  });

  it("forgets the messages Clear withdrew from pi's lane", async () => {
    const { service, ref, lane } = await inboxService("handed-clear");
    await service.prompt(ref, "first", undefined, undefined, { clientMessageId: "handed-clear-01" });
    await service.prompt(ref, "second", undefined, undefined, { clientMessageId: "handed-clear-02" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["first", "second"]); });

    await service.clearQueue(ref);

    await vi.waitFor(() => { expect(handedIds(service, "handed-clear")).toEqual([]); });
    expect(service.operationOutcomes("handed-clear", ["handed-clear-01", "handed-clear-02"])).toEqual({ "handed-clear-01": "withdrawn", "handed-clear-02": "withdrawn" });
    await service.dispose();
  });

  it("forgets a message sent without an id when Clear withdraws it from pi's lane", async () => {
    const { service, ref, lane } = await inboxService("handed-clear-anon");
    await service.prompt(ref, "no id here");
    await vi.waitFor(() => { expect([...lane]).toEqual(["no id here"]); });
    const whileInLane = handedTexts(service, "handed-clear-anon");

    await service.clearQueue(ref);

    await vi.waitFor(() => { expect(handedTexts(service, "handed-clear-anon")).toEqual([]); });
    expect(whileInLane).toEqual(["no id here"]);
    await service.dispose();
  });

  it("forgets a message sent without an id when it is recalled out of pi's lane", async () => {
    const { service, ref, lane } = await inboxService("handed-recall-anon");
    await service.prompt(ref, "no id either");
    await vi.waitFor(() => { expect([...lane]).toEqual(["no id either"]); });

    const recalled = await service.recallQueuedMessage(ref, { kind: "steer", text: "no id either" });

    await vi.waitFor(() => { expect(handedTexts(service, "handed-recall-anon")).toEqual([]); });
    expect(recalled.recalled).toBe(true);
    await service.dispose();
  });

  it("forgets a message pi refused for good", async () => {
    const { fake, service, ref } = await inboxService("handed-refused", { isStreaming: false });
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      return Promise.reject(new Error("No model selected"));
    };
    await service.prompt(ref, "cannot run", undefined, undefined, { clientMessageId: "handed-refused-01" });

    await vi.waitFor(() => { expect(service.operationOutcomes("handed-refused", ["handed-refused-01"])).toEqual({ "handed-refused-01": "failed" }); });
    await vi.waitFor(() => { expect(handedIds(service, "handed-refused")).toEqual([]); });
    await service.dispose();
  });
});

describe("a direct prompt refused after preflight keeps its place (O3)", () => {
  it("puts the message back at the head when another run started during its preflight, and hands it later", async () => {
    const { fake, service, ref } = await inboxService("o3-race", { isStreaming: false });
    let refuse = true;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      options?.preflightResult?.("started");
      if (refuse) {
        refuse = false;
        return Promise.reject(new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."));
      }
      return Promise.resolve();
    };
    await service.prompt(ref, "A", undefined, undefined, { clientMessageId: "o3-a-0001" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A"]); });
    await vi.waitFor(async () => { expect((await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["o3-a-0001"]); });
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A", "A"]); });
    expect(service.operationOutcomes("o3-race", ["o3-a-0001"])).toEqual({ "o3-a-0001": "succeeded" });
    await service.dispose();
  });
});

describe("Stop waits for a steer batch in flight (O4)", () => {
  it("hands back every message of the batch, and none lands after the stop", async () => {
    const { fake, service, ref, lane } = await inboxService("o4-stop");
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (options?.streamingBehavior === "steer" && fake.session.isStreaming) lane.push(text);
      options?.preflightResult?.(options.streamingBehavior === "steer" && fake.session.isStreaming ? "queued" : "started");
    };
    await service.prompt(ref, "X", undefined, undefined, { clientMessageId: "o4-x-0001" });
    await service.prompt(ref, "Y", undefined, undefined, { clientMessageId: "o4-y-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); }, { interval: 1 });
    const { discarded } = await service.abort(ref);
    fake.session.isStreaming = false;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect({ discarded: discarded.map((entry) => entry.clientMessageId), lane: [...lane] }).toEqual({ discarded: ["o4-x-0001", "o4-y-0001"], lane: [] });
    expect(service.operationOutcomes("o4-stop", ["o4-x-0001", "o4-y-0001"])).toEqual({ "o4-x-0001": "withdrawn", "o4-y-0001": "withdrawn" });
    await service.dispose();
  });
});

describe("a waiting message's identity cannot be claimed by someone else's commit (O5)", () => {
  it("does not stamp another source's identical text with the id of a message still in the inbox", async () => {
    const { fake, service, ref } = await inboxService("o5-claim");
    await service.prompt(ref, "continue", undefined, undefined, { clientMessageId: "o5-x-0001" });
    const foreign: Record<string, unknown> = { role: "user", content: [{ type: "text", text: "continue" }] };
    fake.emit({ type: "message_start", message: foreign });
    expect({ stamped: foreign["clientMessageId"], outcome: service.operationOutcomes("o5-claim", ["o5-x-0001"]) }).toEqual({ stamped: undefined, outcome: { "o5-x-0001": "pending" } });
    await service.dispose();
  });
});

describe("closing a session keeps what pi had not read yet (L1)", () => {
  it("takes a handed, unread steer back into the inbox, and the next daemon hands it", async () => {
    const first = await inboxService("l1-close");
    await first.service.prompt(first.ref, "unread steer", undefined, undefined, { clientMessageId: "l1-s-0001" });
    first.fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(first.lane).toEqual(["unread steer"]); });
    await first.service.stop(first.ref);
    await first.service.dispose();

    const second = await inboxService("l1-close", { dir: first.dir, dataDir: first.dataDir, isStreaming: false });
    await expect(second.service.resumeWaitingInboxes()).resolves.toEqual(["l1-close"]);
    await vi.waitFor(() => { expect(texts(second.fake.calls.prompt)).toEqual(["unread steer"]); });
    await second.service.dispose();
  });
});

describe("pi takes every waiting steer at one gap (L2)", () => {
  it("re-applies steeringMode all before each batch, after something reset it", async () => {
    const { fake, service, ref } = await inboxService("l2-mode");
    await service.status(ref);
    fake.session.agent.steeringMode = "one-at-a-time";
    await service.prompt(ref, "S", undefined, undefined, { clientMessageId: "l2-s-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["S"]); });
    expect(fake.session.agent.steeringMode).toBe("all");
    await service.dispose();
  });
});

describe("a slash command's run does not hold later messages until it ends (L3)", () => {
  it("steers a message sent during the command's run at the run's next gap", async () => {
    const { fake, service, ref, lane } = await inboxService("l3-command", { isStreaming: false });
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "feynman_teach" }];
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (options?.streamingBehavior === "steer" && fake.session.isStreaming) {
        lane.push(text);
        options.preflightResult?.("queued");
        return Promise.resolve();
      }
      fake.session.isStreaming = true;
      fake.emit({ type: "agent_start" });
      return new Promise<void>(() => undefined);
    };
    await service.prompt(ref, "/feynman_teach NAT", undefined, undefined, { clientMessageId: "l3-cmd-0001" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["/feynman_teach NAT"]); });
    await service.prompt(ref, "B during the command", undefined, undefined, { clientMessageId: "l3-b-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["B during the command"]); });
    await service.dispose();
  });
});

describe("fresh-lane findings over the fixes", () => {
  it("F1: keeps a steer that is still being handed pending, with its id, when another steer is read meanwhile", async () => {
    const { fake, service, ref, lane, readSteer } = await inboxService("f1-inflight");
    let releaseSecond = (): void => undefined;
    const secondGate = new Promise<void>((resolve) => { releaseSecond = resolve; });
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (text === "S2") await secondGate;
      lane.push(text);
      options?.preflightResult?.("queued");
    };
    await service.prompt(ref, "S1", undefined, undefined, { clientMessageId: "f1-s1-0001" });
    fake.emit({ type: "tool_execution_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["S1"]); });
    await service.prompt(ref, "S2", undefined, undefined, { clientMessageId: "f1-s2-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["S1", "S2"]); });
    readSteer("S1");
    expect(service.operationOutcomes("f1-inflight", ["f1-s1-0001", "f1-s2-0001"])).toEqual({ "f1-s1-0001": "succeeded", "f1-s2-0001": "pending" });
    releaseSecond();
    await vi.waitFor(async () => { expect((await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["f1-s2-0001"]); });
    await service.dispose();
  });

  it("F2: does not hand the rest of a steer batch into a run that stopped streaming meanwhile", async () => {
    const { fake, service, ref, lane } = await inboxService("f2-batch");
    await service.status(ref);
    fake.emit({ type: "agent_start" });
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (options?.streamingBehavior === "steer") {
        lane.push(text);
        fake.session.isStreaming = false;
      }
      options?.preflightResult?.(options.streamingBehavior === "steer" ? "queued" : "started");
      if (options?.streamingBehavior === undefined) fake.session.isStreaming = true;
    };
    await service.prompt(ref, "A", undefined, undefined, { clientMessageId: "f2-a-0001" });
    await service.prompt(ref, "B", undefined, undefined, { clientMessageId: "f2-b-0001" });
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A"]); });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(texts(fake.calls.prompt)).toEqual(["A"]);
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A", "A"]); });
    expect(fake.calls.prompt.map(handedAs)).toEqual(["steer", undefined]);
    expect(texts(fake.calls.steer)).toEqual(["B"]);
    await service.dispose();
  });

  it("F2: never puts back a message the agent already read, whatever its promise says later", async () => {
    const { fake, service, ref } = await inboxService("f2-committed", { isStreaming: false });
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      options?.preflightResult?.("started");
      fake.emit({ type: "agent_start" });
      fake.emit({ type: "message_start", message: { role: "user", content: text } });
      return Promise.reject(new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."));
    };
    await service.prompt(ref, "P", undefined, undefined, { clientMessageId: "f2-p-0001" });
    await vi.waitFor(() => { expect(service.operationOutcomes("f2-committed", ["f2-p-0001"])).toEqual({ "f2-p-0001": "succeeded" }); });
    fake.emit({ type: "agent_settled" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect({ calls: texts(fake.calls.prompt), queued: (await service.status(ref)).queuedMessages }).toEqual({ calls: ["P"], queued: [] });
    await service.dispose();
  });

  it("F3: does not announce withdrawn, or hand back, a message the agent read while Stop was clearing", async () => {
    const { hub, fake, service, ref, lane, readSteer } = await inboxService("f3-stop");
    await service.prompt(ref, "X", undefined, undefined, { clientMessageId: "f3-x-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["X"]); });
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    const clear = queue.clear.bind(queue);
    vi.spyOn(queue, "clear").mockImplementation((sessionId: string) => {
      readSteer("X");
      return clear(sessionId);
    });
    const { discarded } = await service.abort(ref);
    const withdrawn = hub.sessionEvents.filter(({ event }) => event.type === "prompt.withdrawn").map(({ event }): unknown => Reflect.get(event, "clientMessageId"));
    expect({ discarded: discarded.map((entry) => entry.clientMessageId), withdrawn, outcome: service.operationOutcomes("f3-stop", ["f3-x-0001"]) })
      .toEqual({ discarded: [], withdrawn: [], outcome: { "f3-x-0001": "succeeded" } });
    await service.dispose();
  });

  it("F4: a prompt whose preflight saw the agent's loop busy is not marked read by that other run's message", async () => {
    const { fake, service, ref } = await inboxService("f4-busy-loop", { isStreaming: false });
    const agentState = { isStreaming: false };
    Reflect.set(fake.session.agent, "state", agentState);
    let refuse = true;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (!refuse) {
        options?.preflightResult?.("started");
        return Promise.resolve();
      }
      refuse = false;
      agentState.isStreaming = true;
      options?.preflightResult?.("started");
      fake.emit({ type: "message_start", message: { role: "user", content: "another run's message" } });
      agentState.isStreaming = false;
      return Promise.reject(new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."));
    };
    await service.prompt(ref, "Q", undefined, undefined, { clientMessageId: "f4-q-0001" });
    await vi.waitFor(async () => { expect((await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["f4-q-0001"]); });
    expect(service.operationOutcomes("f4-busy-loop", ["f4-q-0001"])).toEqual({ "f4-q-0001": "pending" });
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["Q", "Q"]); });
    await service.dispose();
  });
});

describe("second fresh-lane findings", () => {
  it("A: Stop discards a message a batch put back after meeting a finished run, instead of withdrawing it and running it", async () => {
    const { fake, service, ref, lane } = await inboxService("a-late-restore");
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (options?.streamingBehavior === "steer") lane.push(text);
      options?.preflightResult?.(options.streamingBehavior === "steer" ? "queued" : "started");
      fake.session.isStreaming = false;
    };
    await service.prompt(ref, "X", undefined, undefined, { clientMessageId: "a-x-00001" });
    await service.prompt(ref, "Y", undefined, undefined, { clientMessageId: "a-y-00001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); }, { interval: 1 });
    const { discarded } = await service.abort(ref);
    fake.emit({ type: "agent_settled" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect({ discarded: discarded.map((entry) => entry.clientMessageId).sort(), calls: texts(fake.calls.prompt), queued: (await service.status(ref)).queuedMessages })
      .toEqual({ discarded: ["a-x-00001", "a-y-00001"], calls: ["X"], queued: [] });
    await service.dispose();
  });

  it("B: a direct prompt the SDK queued as a steer stays pending, and keeps its id when taken back", async () => {
    const { fake, service, ref, lane } = await inboxService("b-direct-to-lane", { isStreaming: false });
    let first = true;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (first) {
        first = false;
        fake.session.isStreaming = true;
        lane.push(text);
      }
      options?.preflightResult?.(fake.session.isStreaming ? "queued" : "started");
      return Promise.resolve();
    };
    await service.prompt(ref, "Q", undefined, undefined, { clientMessageId: "b-q-00001" });
    await vi.waitFor(() => { expect(lane).toEqual(["Q"]); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.operationOutcomes("b-direct-to-lane", ["b-q-00001"])).toEqual({ "b-q-00001": "pending" });
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["Q", "Q"]); });
    expect(service.operationOutcomes("b-direct-to-lane", ["b-q-00001"])).toEqual({ "b-q-00001": "succeeded" });
    await service.dispose();
  });

  it("B: a steer the SDK ran as a new prompt is never put back once the agent read it", async () => {
    const { fake, service, ref } = await inboxService("b-lane-to-run");
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      fake.session.isStreaming = false;
      options?.preflightResult?.("started");
      fake.emit({ type: "agent_start" });
      fake.emit({ type: "message_start", message: { role: "user", content: text } });
      return Promise.reject(new Error("Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion."));
    };
    await service.prompt(ref, "S", undefined, undefined, { clientMessageId: "b-s-00001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(service.operationOutcomes("b-lane-to-run", ["b-s-00001"])).toEqual({ "b-s-00001": "succeeded" }); });
    fake.emit({ type: "agent_settled" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect({ calls: texts(fake.calls.prompt), queued: (await service.status(ref)).queuedMessages }).toEqual({ calls: ["S"], queued: [] });
    await service.dispose();
  });

  it("C: hands nothing while the SDK is emitting agent_settled, then hands it once that is over", async () => {
    const { fake, service, ref } = await inboxService("c-deferral", { isStreaming: false });
    await service.status(ref);
    Reflect.set(fake.session, "_isEmittingAgentSettled", true);
    await service.prompt(ref, "D", undefined, undefined, { clientMessageId: "c-d-00001" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.calls.prompt).toHaveLength(0);
    Reflect.set(fake.session, "_isEmittingAgentSettled", false);
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["D"]); });
    await service.dispose();
  });

  it("C: a prompt that returns without ever reaching preflight is not reported as read", async () => {
    const { fake, service, ref } = await inboxService("c-no-preflight", { isStreaming: false });
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      return Promise.resolve();
    };
    await service.prompt(ref, "E", undefined, undefined, { clientMessageId: "c-e-00001" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["E"]); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(service.operationOutcomes("c-no-preflight", ["c-e-00001"])).toEqual({ "c-e-00001": "pending" });
    await service.dispose();
  });
});

describe("gate-lane findings", () => {
  it("P1-1: a command handled while the agent runs is not recorded as a steer, so ids do not shift and Stop withdraws the right message", async () => {
    const { hub, fake, service, ref, lane } = await inboxService("p11-command");
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "goal-pause" }];
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (!text.startsWith("/")) lane.push(text);
      options?.preflightResult?.(text.startsWith("/") ? "handled" : "queued");
      return Promise.resolve();
    };
    await service.prompt(ref, "S1", undefined, undefined, { clientMessageId: "p11-s1-001" });
    await service.prompt(ref, "/goal-pause", undefined, undefined, { clientMessageId: "p11-cmd-01" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["S1", "/goal-pause"]); });
    await vi.waitFor(() => { expect(service.operationOutcomes("p11-command", ["p11-cmd-01"])).toEqual({ "p11-cmd-01": "consumed" }); });
    expect((await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["p11-s1-001"]);
    const { discarded } = await service.abort(ref);
    const withdrawn = hub.sessionEvents.filter(({ event }) => event.type === "prompt.withdrawn").map(({ event }): unknown => Reflect.get(event, "clientMessageId"));
    expect({ discarded: discarded.map((entry) => entry.clientMessageId), withdrawn, outcomes: service.operationOutcomes("p11-command", ["p11-s1-001", "p11-cmd-01"]) })
      .toEqual({ discarded: ["p11-s1-001"], withdrawn: ["p11-s1-001"], outcomes: { "p11-s1-001": "withdrawn", "p11-cmd-01": "consumed" } });
    await service.dispose();
  });

  it("P2-1: hands no steer while the SDK emits agent_settled, even with the agent loop flag set", async () => {
    const { fake, service, ref } = await inboxService("p21-deferral");
    await service.status(ref);
    const agentState = { isStreaming: true };
    Reflect.set(fake.session.agent, "state", agentState);
    Reflect.set(fake.session, "_isEmittingAgentSettled", true);
    await service.prompt(ref, "T", undefined, undefined, { clientMessageId: "p21-t-0001" });
    fake.emit({ type: "turn_end" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.calls.prompt).toHaveLength(0);
    Reflect.set(fake.session, "_isEmittingAgentSettled", false);
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["T"]); });
    await service.dispose();
  });

  it("P2-2: recalling a message pi still holds after its run ended does not replay the rest as runs under the lock", async () => {
    const { fake, service, ref, lane } = await inboxService("p22-recall");
    await service.prompt(ref, "S1", undefined, undefined, { clientMessageId: "p22-s1-001" });
    await service.prompt(ref, "S2", undefined, undefined, { clientMessageId: "p22-s2-001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["S1", "S2"]); });
    fake.session.isStreaming = false;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      options?.preflightResult?.("started");
      fake.emit({ type: "agent_start" });
      fake.emit({ type: "message_start", message: { role: "user", content: text } });
      return new Promise<void>(() => undefined);
    };
    const recall = service.recallQueuedMessage(ref, { kind: "steer", text: "S1", clientMessageId: "p22-s1-001" });
    const answered = await Promise.race([recall.then((result) => result.recalled), new Promise((resolve) => setTimeout(() => { resolve("recall still waiting on the survivor's run"); }, 500))]);
    expect(answered).toBe(true);
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["S1", "S2", "S2"]); });
    expect(fake.calls.prompt.map(handedAs)).toEqual(["steer", "steer", undefined]);
    expect(service.operationOutcomes("p22-recall", ["p22-s1-001", "p22-s2-001"])).toEqual({ "p22-s1-001": "withdrawn", "p22-s2-001": "succeeded" });
    await service.dispose();
  });
});

describe("second gate-lane findings", () => {
  it("G1: a command whose handler pushes a message is still handled, not recorded as queued", async () => {
    const { fake, service, ref, lane } = await inboxService("g1-inject");
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "kickoff" }];
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (text.startsWith("/")) lane.push("injected by the command");
      else lane.push(text);
      options?.preflightResult?.(text.startsWith("/") ? "handled" : "queued");
      return Promise.resolve();
    };
    await service.prompt(ref, "/kickoff now", undefined, undefined, { clientMessageId: "g1-cmd-001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(service.operationOutcomes("g1-inject", ["g1-cmd-001"])).toEqual({ "g1-cmd-001": "consumed" }); });
    expect((await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId)).toEqual([undefined]);
    await service.dispose();
  });

  it("G2: Stop does not wait for a command's handler inside a steer batch", async () => {
    const { fake, service, ref, lane } = await inboxService("g2-handler");
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "ask-me" }];
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (text.startsWith("/")) await new Promise<void>(() => undefined);
      lane.push(text);
      options?.preflightResult?.("queued");
    };
    await service.prompt(ref, "/ask-me", undefined, undefined, { clientMessageId: "g2-cmd-001" });
    await service.prompt(ref, "after the command", undefined, undefined, { clientMessageId: "g2-s2-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["/ask-me", "after the command"]); });
    const stop = service.abort(ref);
    const answered = await Promise.race([stop.then((result) => result.discarded.map((entry) => entry.clientMessageId)), new Promise((resolve) => setTimeout(() => { resolve("stop still waiting on the handler"); }, 500))]);
    expect(answered).toEqual(["g2-s2-0001"]);
    await service.dispose();
  });

  it("G3: a handled command leaves no identity for a later message with the same text", async () => {
    const { fake, service, ref } = await inboxService("g3-expect", { isStreaming: false });
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "tidy" }];
    await service.prompt(ref, "/tidy", undefined, undefined, { clientMessageId: "g3-cmd-001" });
    await vi.waitFor(() => { expect(service.operationOutcomes("g3-expect", ["g3-cmd-001"])).toEqual({ "g3-cmd-001": "consumed" }); });
    const later: Record<string, unknown> = { role: "user", content: [{ type: "text", text: "/tidy" }] };
    fake.emit({ type: "message_start", message: later });
    expect(later["clientMessageId"]).toBeUndefined();
    await service.dispose();
  });

  it("G4/A: recall, Clear and Stop all leave messages the agent loop has already taken, which settle as read", async () => {
    const { fake, service, ref, lane } = await inboxService("g4-drained");
    await service.prompt(ref, "being read", undefined, undefined, { clientMessageId: "g4-s-00001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["being read"]); });
    drainAgentQueues(fake.session.agent);
    fake.session.isCompacting = true;
    const recalled = await service.recallQueuedMessage(ref, { kind: "steer", text: "being read", clientMessageId: "g4-s-00001" });
    await service.clearQueue(ref);
    const { discarded } = await service.abort(ref);
    expect({ recalled: recalled.recalled, discarded, inbox: (await service.status(ref)).queuedMessages, outcome: service.operationOutcomes("g4-drained", ["g4-s-00001"]) })
      .toEqual({ recalled: false, discarded: [], inbox: [], outcome: { "g4-s-00001": "succeeded" } });
    await service.dispose();
  });
});

describe("third gate-lane findings", () => {
  it("B: closing a session does not put a loop-held steer back in the inbox, so the next daemon does not run it again", async () => {
    const first = await inboxService("b-close-held");
    await first.service.prompt(first.ref, "drained before close", undefined, undefined, { clientMessageId: "gb-s-00001" });
    first.fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...first.lane]).toEqual(["drained before close"]); });
    drainAgentQueues(first.fake.session.agent);
    first.fake.session.isCompacting = true;
    await first.service.stop(first.ref);
    await first.service.dispose();

    const second = await inboxService("b-close-held", { dir: first.dir, dataDir: first.dataDir, isStreaming: false });
    await expect(second.service.resumeWaitingInboxes()).resolves.toEqual([]);
    await second.service.status(second.ref);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect({ calls: second.fake.calls.prompt, outcome: second.service.operationOutcomes("b-close-held", ["gb-s-00001"]) })
      .toEqual({ calls: [], outcome: { "gb-s-00001": "succeeded" } });
    await second.service.dispose();
  });

  it("C: a queued subsession notice does not hide that the loop holds a steer", async () => {
    const { hub, fake, service, ref, lane } = await inboxService("c-custom-follow-up");
    await service.prompt(ref, "held steer", undefined, undefined, { clientMessageId: "gc-s-00001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["held steer"]); });
    drainAgentQueues(fake.session.agent, { followUp: [{ role: "custom", customType: "subsession-notice" }] });
    Reflect.set(fake.session.agent, "hasQueuedMessages", () => true);
    fake.session.isCompacting = true;
    const recalled = await service.recallQueuedMessage(ref, { kind: "steer", text: "held steer", clientMessageId: "gc-s-00001" });
    await service.clearQueue(ref);
    const withdrawn = hub.sessionEvents.filter(({ event }) => event.type === "prompt.withdrawn").map(({ event }): unknown => Reflect.get(event, "clientMessageId"));
    expect({ recalled: recalled.recalled, withdrawn, outcome: service.operationOutcomes("c-custom-follow-up", ["gc-s-00001"]) }).toEqual({ recalled: false, withdrawn: [], outcome: { "gc-s-00001": "succeeded" } });
    await service.dispose();
  });

  it("C: only the loop-held part of a lane is left; a steer queued after the drain is still handed back", async () => {
    const { fake, service, ref, lane } = await inboxService("c-partial");
    await service.prompt(ref, "S1 drained", undefined, undefined, { clientMessageId: "gc-s1-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["S1 drained"]); });
    await service.prompt(ref, "S2 still queued", undefined, undefined, { clientMessageId: "gc-s2-0001" });
    fake.emit({ type: "tool_execution_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["S1 drained", "S2 still queued"]); });
    drainAgentQueues(fake.session.agent, { steer: [{ role: "user", content: "S2 still queued" }] });
    const { discarded } = await service.abort(ref);
    expect({ discarded: discarded.map((entry) => entry.clientMessageId), outcomes: service.operationOutcomes("c-partial", ["gc-s1-0001", "gc-s2-0001"]) })
      .toEqual({ discarded: ["gc-s2-0001"], outcomes: { "gc-s1-0001": "succeeded", "gc-s2-0001": "withdrawn" } });
    await service.dispose();
  });

  it("D: a slash text the SDK does not parse as a command is recorded as the steer pi queues", async () => {
    const { fake, service, ref, lane } = await inboxService("d-newline");
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "tidy" }];
    await service.prompt(ref, "/tidy\nnow", undefined, undefined, { clientMessageId: "gd-s-00001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["/tidy\nnow"]); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect({ outcome: service.operationOutcomes("d-newline", ["gd-s-00001"]), queued: (await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId) })
      .toEqual({ outcome: { "gd-s-00001": "pending" }, queued: ["gd-s-00001"] });
    await service.dispose();
  });
});

describe("fourth gate-lane findings", () => {
  it("P1-1: in one-at-a-time mode, still-queued steers are not counted as taken by the loop, so Stop hands them back", async () => {
    const { fake, service, ref, lane } = await inboxService("p11-one-at-a-time");
    await service.prompt(ref, "T1", undefined, undefined, { clientMessageId: "g4p-t1-001" });
    await service.prompt(ref, "T2", undefined, undefined, { clientMessageId: "g4p-t2-001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["T1", "T2"]); });
    drainAgentQueues(fake.session.agent, { steer: [{ role: "user", content: "T1" }, { role: "user", content: "T2" }] }, "one-at-a-time");
    const { discarded } = await service.abort(ref);
    expect({ discarded: discarded.map((entry) => entry.clientMessageId), outcomes: service.operationOutcomes("p11-one-at-a-time", ["g4p-t1-001", "g4p-t2-001"]) })
      .toEqual({ discarded: ["g4p-t1-001", "g4p-t2-001"], outcomes: { "g4p-t1-001": "withdrawn", "g4p-t2-001": "withdrawn" } });
    await service.dispose();
  });

  it("P2-1: a fault in pi-web's own event handling does not escape into the agent loop", async () => {
    const { fake, service, ref } = await inboxService("p21-listener");
    await service.status(ref);
    const broken: unknown = Reflect.get(service, "publishStatus");
    Reflect.set(service, "publishStatus", () => { throw new Error("status publication failed"); });
    expect(() => { fake.emit({ type: "turn_end" }); }).not.toThrow();
    Reflect.set(service, "publishStatus", broken);
    await service.dispose();
  });

  it("P2-2: a loop-held steer committed during close still carries its sender's id", async () => {
    const { fake, service, ref, lane } = await inboxService("p22-close-stamp");
    await service.prompt(ref, "committed during close", undefined, undefined, { clientMessageId: "g4p-c-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["committed during close"]); });
    drainAgentQueues(fake.session.agent);
    fake.session.isCompacting = true;
    const committed: Record<string, unknown> = { role: "user", content: [{ type: "text", text: "committed during close" }] };
    fake.session.abort = () => {
      fake.emit({ type: "message_start", message: committed });
      return Promise.resolve();
    };
    await service.stop(ref);
    expect(committed["clientMessageId"]).toBe("g4p-c-0001");
    await service.dispose();
  });
});

describe("fifth gate-lane findings", () => {
  it("F1 / gate 6 P1-1: a session is not reopened while its old runtime is closing, and the message sent meanwhile lands stamped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "inbox-review-f1-"));
    const dataDir = await mkdtemp(join(tmpdir(), "inbox-review-f1-data-"));
    const old = fakeRuntime("f1-reopen", { isStreaming: false });
    const fresh = fakeRuntime("f1-reopen", { isStreaming: false });
    for (const fake of [old, fresh]) {
      Reflect.set(fake.runtime, "cwd", dir);
      fake.session.sessionManager.getCwd = () => dir;
    }
    let releaseAbort = (): void => undefined;
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve; });
    old.session.abort = () => abortGate;
    const runtimes = [old.runtime, fresh.runtime];
    let created = 0;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime: testModelRuntime,
      createAgentRuntime: () => Promise.resolve(runtimes[created++] ?? fresh.runtime),
      sessionManager: sessionGateway([sessionRecord("f1-reopen", dir)]),
      heartbeatIntervalMs: 60_000,
      operationLedgerDir: dataDir,
    });
    const ref = sessionRef("f1-reopen", dir);
    await service.status(ref);
    const closing = service.stop(ref);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const sending = service.prompt(ref, "hello again", undefined, undefined, { clientMessageId: "g5f1-x-0001" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect({ runtimesCreated: created, handedToFresh: fresh.calls.prompt.length }).toEqual({ runtimesCreated: 1, handedToFresh: 0 });
    releaseAbort();
    await closing;
    await sending;
    await vi.waitFor(() => { expect(texts(fresh.calls.prompt)).toEqual(["hello again"]); });
    const committed: Record<string, unknown> = { role: "user", content: [{ type: "text", text: "hello again" }] };
    fresh.emit({ type: "message_start", message: committed });
    expect(committed["clientMessageId"]).toBe("g5f1-x-0001");
    await service.dispose();
  });

  it("F2: daemon shutdown keeps a steer pi held unread, and the next daemon hands it", async () => {
    const first = await inboxService("f2-shutdown");
    await first.service.prompt(first.ref, "unread at shutdown", undefined, undefined, { clientMessageId: "g5f2-s-001" });
    first.fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...first.lane]).toEqual(["unread at shutdown"]); });
    await first.service.dispose();

    const second = await inboxService("f2-shutdown", { dir: first.dir, dataDir: first.dataDir, isStreaming: false });
    await expect(second.service.resumeWaitingInboxes()).resolves.toEqual(["f2-shutdown"]);
    await vi.waitFor(() => { expect(texts(second.fake.calls.prompt)).toEqual(["unread at shutdown"]); });
    await second.service.dispose();
  });

  it("F2: daemon shutdown still stamps and settles a steer the loop commits during the abort", async () => {
    const { fake, service, ref, lane } = await inboxService("f2-shutdown-held");
    await service.prompt(ref, "committed at shutdown", undefined, undefined, { clientMessageId: "g5f2-h-001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["committed at shutdown"]); });
    drainAgentQueues(fake.session.agent);
    const committed: Record<string, unknown> = { role: "user", content: [{ type: "text", text: "committed at shutdown" }] };
    fake.session.abort = () => {
      fake.emit({ type: "message_start", message: committed });
      return Promise.resolve();
    };
    await service.dispose();
    expect({ stamped: committed["clientMessageId"], outcome: service.operationOutcomes("f2-shutdown-held", ["g5f2-h-001"]) })
      .toEqual({ stamped: "g5f2-h-001", outcome: { "g5f2-h-001": "succeeded" } });
  });

  it("F3: a failed ledger write when a direct prompt is read does not keep the consumer handing for the whole run", async () => {
    const { fake, service, ref, lane } = await inboxService("f3-ledger-fault", { isStreaming: false });
    const ledger: unknown = Reflect.get(service, "acceptanceLedger");
    if (typeof ledger !== "object" || ledger === null) throw new Error("acceptanceLedger unavailable");
    const settle: unknown = Reflect.get(ledger, "settle");
    let failOnce = true;
    Reflect.set(ledger, "settle", (...args: unknown[]): unknown => {
      if (failOnce && args[2] === "succeeded") {
        failOnce = false;
        throw new Error("disk full");
      }
      const result: unknown = typeof settle === "function" ? Reflect.apply(settle, ledger, args) : undefined;
      return result;
    });
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (options?.streamingBehavior === "steer" && fake.session.isStreaming) {
        lane.push(text);
        options.preflightResult?.("queued");
        return Promise.resolve();
      }
      options?.preflightResult?.("started");
      fake.session.isStreaming = true;
      fake.emit({ type: "agent_start" });
      fake.emit({ type: "message_start", message: { role: "user", content: text } });
      return new Promise<void>(() => undefined);
    };
    await service.prompt(ref, "long run", undefined, undefined, { clientMessageId: "g5f3-d-001" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["long run"]); });
    await service.prompt(ref, "steer during it", undefined, undefined, { clientMessageId: "g5f3-s-001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["steer during it"]); });
    await service.dispose();
  });
});

describe("sixth gate-lane findings", () => {
  it("P2-1 / gate 7 P1-B: a restore landing after the session's close is written to its file without erasing what else waits", async () => {
    const { service, ref, dir, dataDir } = await inboxService("p21-late", { isCompacting: true });
    await service.prompt(ref, "A taken by a batch", undefined, undefined, { clientMessageId: "g6p21-a-001" });
    await service.prompt(ref, "B accepted meanwhile", undefined, undefined, { clientMessageId: "g6p21-b-001" });
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    const [taken] = await queue.take("p21-late", 1);
    if (taken === undefined) throw new Error("nothing taken");
    const forgetInboxState: unknown = Reflect.get(service, "forgetInboxState");
    if (typeof forgetInboxState !== "function") throw new Error("forgetInboxState unavailable");
    Reflect.apply(forgetInboxState, service, ["p21-late"]);
    await queue.restoreFront("p21-late", [taken]);
    const reopened = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    expect((await reopened.open("p21-late", dir)).map((waiting) => waiting.clientMessageId)).toEqual(["g6p21-a-001", "g6p21-b-001"]);
    await service.dispose();
  });

  it("P2-2: a take-back that fails at close does not skip the runtime's abort and disposal", async () => {
    const { fake, service, ref, lane } = await inboxService("p22-takeback-fault");
    await service.prompt(ref, "unread", undefined, undefined, { clientMessageId: "g6p22-s-001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect([...lane]).toEqual(["unread"]); });
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    vi.spyOn(queue, "restoreFront").mockRejectedValue(new Error("disk full"));
    await service.stop(ref);
    expect({ aborted: fake.calls.abort, disposed: fake.calls.dispose }).toEqual({ aborted: 1, disposed: 1 });
    await service.dispose();
  });
});

describe("seventh gate-lane findings", () => {
  async function twoRuntimes(sessionId: string, options: { freshStreaming?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), `inbox-review-${sessionId}-`));
    const dataDir = await mkdtemp(join(tmpdir(), `inbox-review-${sessionId}-data-`));
    const old = fakeRuntime(sessionId, { isStreaming: false });
    const fresh = fakeRuntime(sessionId, { isStreaming: options.freshStreaming ?? false });
    for (const fake of [old, fresh]) {
      Reflect.set(fake.runtime, "cwd", dir);
      fake.session.sessionManager.getCwd = () => dir;
    }
    const runtimes = [old.runtime, fresh.runtime];
    let created = 0;
    const gateway = sessionGateway([sessionRecord(sessionId, dir)]);
    gateway.open = () => fakeSessionManager(dir, { getSessionId: () => sessionId });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime: testModelRuntime,
      createAgentRuntime: () => Promise.resolve(runtimes[created++] ?? fresh.runtime),
      sessionManager: gateway,
      heartbeatIntervalMs: 60_000,
      operationLedgerDir: dataDir,
    });
    return { old, fresh, service, ref: sessionRef(sessionId, dir), created: () => created };
  }

  it("P1-A: a second close that finds a reopen waiting on the first close does not deadlock", async () => {
    const { old, service, ref } = await twoRuntimes("p1a-two-closes");
    let releaseAbort = (): void => undefined;
    old.session.abort = () => new Promise<void>((resolve) => { releaseAbort = resolve; });
    await service.status(ref);
    const firstClose = service.stop(ref);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const reopen = service.status(ref);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const closeActive: unknown = Reflect.get(service, "closeActive");
    if (typeof closeActive !== "function") throw new Error("closeActive unavailable");
    const secondCloseResult: unknown = Reflect.apply(closeActive, service, ["p1a-two-closes"]);
    const secondClose = Promise.resolve(secondCloseResult);
    releaseAbort();
    const settled = await Promise.race([
      Promise.all([firstClose, reopen, secondClose]).then(() => "all settled"),
      new Promise((resolve) => setTimeout(() => { resolve("deadlocked"); }, 1_000)),
    ]);
    expect(settled).toBe("all settled");
    await service.dispose();
  });

  it("P2-A: late work of a replaced runtime leaves the reopened runtime's steers alone", async () => {
    const { old, fresh, service, ref } = await twoRuntimes("p2a-late-work", { freshStreaming: true });
    await service.status(ref);
    await service.stop(ref);
    const lane: string[] = [];
    fresh.session.getSteeringMessages = () => [...lane];
    fresh.session.prompt = (text: string, options?: PromptOptions) => {
      fresh.calls.prompt.push({ text, options });
      lane.push(text);
      fresh.emit({ type: "queue_update", steering: [...lane], followUp: [] });
      options?.preflightResult?.("queued");
      return Promise.resolve();
    };
    await service.prompt(ref, "steer for the new runtime", undefined, undefined, { clientMessageId: "g7p2a-s-001" });
    fresh.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["steer for the new runtime"]); });
    const takeBack: unknown = Reflect.get(service, "takeBackHeldMessages");
    if (typeof takeBack !== "function") throw new Error("takeBackHeldMessages unavailable");
    await Reflect.apply(takeBack, service, [old.session]);
    expect({ outcome: service.operationOutcomes("p2a-late-work", ["g7p2a-s-001"]), queued: (await service.status(ref)).queuedMessages.map((entry) => entry.clientMessageId) })
      .toEqual({ outcome: { "g7p2a-s-001": "pending" }, queued: ["g7p2a-s-001"] });
    await service.dispose();
  });

  it("P2-B: a close that never finishes stops holding its session id after the ceiling", async () => {
    const { service } = await twoRuntimes("p2b-ceiling");
    vi.useFakeTimers();
    try {
      const markClosing: unknown = Reflect.get(service, "markClosing");
      if (typeof markClosing !== "function") throw new Error("markClosing unavailable");
      Reflect.apply(markClosing, service, ["p2b-ceiling"]);
      const closing: unknown = Reflect.get(service, "closingSessions");
      if (!(closing instanceof Map)) throw new Error("closingSessions unavailable");
      expect(closing.has("p2b-ceiling")).toBe(true);
      vi.advanceTimersByTime(10_000);
      expect(closing.has("p2b-ceiling")).toBe(false);
    } finally {
      vi.useRealTimers();
    }
    await service.dispose();
  });
});

describe("eighth gate-lane findings", () => {
  it("P1-1: a direct handoff in flight when the session closes goes back to the inbox instead of running on the closed runtime", async () => {
    const { fake, service, ref, dir, dataDir } = await inboxService("g8-in-flight", { isStreaming: false });
    await service.status(ref);
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    const take = queue.take.bind(queue);
    let releaseTake = (): void => undefined;
    const takeGate = new Promise<void>((resolve) => { releaseTake = resolve; });
    vi.spyOn(queue, "take").mockImplementation(async (sessionId: string, count: number) => {
      await takeGate;
      return take(sessionId, count);
    });
    await service.prompt(ref, "sent just before stop", undefined, undefined, { clientMessageId: "g8p1-d-0001" });
    const closing = service.stop(ref);
    await new Promise((resolve) => setTimeout(resolve, 20));
    releaseTake();
    await closing;
    const reopened = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    expect({
      handedToClosedRuntime: fake.calls.prompt.length,
      waiting: (await reopened.open("g8-in-flight", dir)).map((entry) => entry.clientMessageId),
      outcome: service.operationOutcomes("g8-in-flight", ["g8p1-d-0001"]),
    }).toEqual({ handedToClosedRuntime: 0, waiting: ["g8p1-d-0001"], outcome: { "g8p1-d-0001": "pending" } });
    await service.dispose();
  });

  it("P2-1: reopening a session's inbox keeps two waiting messages without ids even when they look alike", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "inbox-review-g8p21-"));
    const twin = { lane: "steer" as const, text: "continue", images: [], acceptedAt: "2026-09-29T00:00:00.000Z", echoUserMessage: false };
    const writer = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    await writer.open("g8-twins", "/workspace");
    await writer.push("g8-twins", "/workspace", { ...twin });
    await writer.push("g8-twins", "/workspace", { ...twin });
    const reader = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    expect((await reader.open("g8-twins", "/workspace")).length).toBe(2);
    const again = new OwnedPromptQueue(dataDirInboxLocation(dataDir));
    expect((await again.open("g8-twins", "/workspace")).length).toBe(2);
  });
});

const PNG_ATTACHMENT = { kind: "image" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mimeType: "image/png" };

function archivedAt(sessionId: string, cwd: string, archive: (inputs: readonly { sessionId: string }[]) => void = () => undefined) {
  const record = { sessionId, cwd, archivedAt: "2026-09-29T00:00:00.000Z", archivePath: `/archive/${sessionId}.jsonl` };
  return {
    list: () => Promise.resolve([record]),
    get: (id: string) => Promise.resolve(id === sessionId ? record : undefined),
    archive: () => Promise.reject(new Error("archive should not be called")),
    archiveMany: (inputs: readonly { sessionId: string; cwd: string }[]) => {
      archive(inputs);
      return Promise.resolve(inputs.map((input) => ({ ...input, archivedAt: record.archivedAt })));
    },
    restore: () => Promise.resolve(),
    isArchived: (id: string) => Promise.resolve(id === sessionId),
  };
}

describe("ninth gate-lane findings", () => {
  it("F1: at Stop, a steer sent without an id and one with an id come back as themselves", async () => {
    const { fake, service, ref, lane } = await inboxService("g9-mixed-stop");
    await service.prompt(ref, "A without id");
    await service.prompt(ref, "B with id", undefined, undefined, { clientMessageId: "g9f1-b-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["A without id", "B with id"]); });
    const { discarded } = await service.abort(ref);
    expect({
      discarded: discarded.map((entry) => ({ text: entry.text, id: entry.clientMessageId })),
      outcome: service.operationOutcomes("g9-mixed-stop", ["g9f1-b-0001"]),
    }).toEqual({
      discarded: [{ text: "A without id", id: undefined }, { text: "B with id", id: "g9f1-b-0001" }],
      outcome: { "g9f1-b-0001": "withdrawn" },
    });
    await service.dispose();
  });

  it("F1: at close, a steer sent without an id and one with an id go back to the inbox as themselves", async () => {
    const { fake, service, ref, lane, dir, dataDir } = await inboxService("g9-mixed-close");
    await service.prompt(ref, "A without id");
    await service.prompt(ref, "B with id", undefined, undefined, { clientMessageId: "g9f1-b-0002" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["A without id", "B with id"]); });
    await service.stop(ref);
    const reopened = await new OwnedPromptQueue(dataDirInboxLocation(dataDir)).open("g9-mixed-close", dir);
    expect(reopened.map((entry) => ({ text: entry.text, id: entry.clientMessageId }))).toEqual([
      { text: "A without id", id: undefined },
      { text: "B with id", id: "g9f1-b-0002" },
    ]);
    await service.dispose();
  });

  it("F2: Stop during a direct handoff that has not reached its run stops the run the handoff then starts", async () => {
    const { fake, service, ref } = await inboxService("g9-stop-early", { isStreaming: false });
    let releasePrompt = (): void => undefined;
    const beforeRun = new Promise<void>((resolve) => { releasePrompt = resolve; });
    let runStarted = false;
    let abortsOfTheRun = 0;
    fake.session.abort = () => {
      if (runStarted) abortsOfTheRun += 1;
      return Promise.resolve();
    };
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      await beforeRun;
      options?.preflightResult?.("started");
      fake.session.isStreaming = true;
      runStarted = true;
      fake.emit({ type: "agent_start" });
      fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text }] } });
    };
    await service.prompt(ref, "X", undefined, undefined, { clientMessageId: "g9f2-x-0001" });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); });
    const stopping = service.abort(ref);
    await new Promise((resolve) => setTimeout(resolve, 10));
    releasePrompt();
    await stopping;
    expect(abortsOfTheRun).toBe(1);
    const cut: Record<string, unknown> = { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Request was aborted" };
    fake.emit({ type: "message_end", message: cut });
    expect(cut["stoppedBy"]).toBe("you");
    await service.dispose();
  });

  it("F3: a closed session with messages waiting is not archived", async () => {
    const { service, ref, dir } = await inboxService("g9-archive-waiting");
    await service.prompt(ref, "still waiting", undefined, undefined, { clientMessageId: "g9f3-w-0001" });
    await service.stop(ref);
    const archived: string[] = [];
    Reflect.set(service, "archiveStore", { ...archivedAt("someone-else", dir, (inputs) => { archived.push(...inputs.map((input) => input.sessionId)); }), list: () => Promise.resolve([]), get: () => Promise.resolve(undefined) });
    const result = await service.archiveMany([{ id: "g9-archive-waiting", cwd: dir }]);
    expect({ archived, archivedSessionIds: result.archivedSessionIds, failures: result.failures.map((failure) => failure.sessionId) })
      .toEqual({ archived: [], archivedSessionIds: [], failures: ["g9-archive-waiting"] });
    await service.dispose();
  });

  it("F3: messages waiting for an archived session are not handed into it at startup or when it is opened to read", async () => {
    const first = await inboxService("g9-archived-resume");
    await first.service.prompt(first.ref, "waits for the archive", undefined, undefined, { clientMessageId: "g9f3-r-0001" });
    await first.service.stop(first.ref);
    await first.service.dispose();

    const second = await inboxService("g9-archived-resume", { dir: first.dir, dataDir: first.dataDir, isStreaming: false });
    Reflect.set(second.service, "archiveStore", archivedAt("g9-archived-resume", first.dir));
    await expect(second.service.resumeWaitingInboxes()).resolves.toEqual([]);
    await second.service.status(second.ref);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(second.fake.calls.prompt).toHaveLength(0);
    await second.service.dispose();
  });

  it("F4: a photo-only steer the agent read is settled, and does not keep the next steer pending", async () => {
    const { fake, service, ref, lane } = await inboxService("g9-photo");
    Reflect.set(fake.session, "_steeringMessages", lane);
    Reflect.set(fake.session, "_emitQueueUpdate", () => { fake.emit({ type: "queue_update", steering: [...lane], followUp: [] }); });
    await service.prompt(ref, "", undefined, [PNG_ATTACHMENT], { clientMessageId: "g9f4-p-0001" });
    await service.prompt(ref, "and this", undefined, undefined, { clientMessageId: "g9f4-b-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual(["", "and this"]); });
    drainAgentQueues(fake.session.agent);
    fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "image", data: PNG_ATTACHMENT.data, mimeType: "image/png" }] } });
    lane.splice(lane.indexOf("and this"), 1);
    fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: "and this" }] } });
    expect({ lane: [...lane], outcomes: service.operationOutcomes("g9-photo", ["g9f4-p-0001", "g9f4-b-0001"]) })
      .toEqual({ lane: [], outcomes: { "g9f4-p-0001": "succeeded", "g9f4-b-0001": "succeeded" } });
    await service.dispose();
  });
});

describe("tenth gate-lane findings", () => {
  it("P2-1: an empty-text follow-up read by the agent does not remove a photo-only steer still waiting, and Stop hands that steer back", async () => {
    const { fake, service, ref, lane } = await inboxService("g10-live-photo");
    const followUp = [""];
    Reflect.set(fake.session, "_steeringMessages", lane);
    Reflect.set(fake.session, "_followUpMessages", followUp);
    Reflect.set(fake.session, "_emitQueueUpdate", () => { fake.emit({ type: "queue_update", steering: [...lane], followUp: [...followUp] }); });
    fake.session.getFollowUpMessages = () => [...followUp];
    await service.prompt(ref, "", undefined, [PNG_ATTACHMENT], { clientMessageId: "g10-p-0001" });
    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(lane).toEqual([""]); });
    drainAgentQueues(fake.session.agent, { steer: [{ role: "user", content: [] }] });
    fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: "" }, { type: "image", data: PNG_ATTACHMENT.data, mimeType: "image/png" }] } });
    expect({ steering: [...lane], followUp: [...followUp], outcome: service.operationOutcomes("g10-live-photo", ["g10-p-0001"]) })
      .toEqual({ steering: [""], followUp: [], outcome: { "g10-p-0001": "pending" } });
    const { discarded } = await service.abort(ref);
    expect({ discarded: discarded.map((entry) => entry.clientMessageId), outcome: service.operationOutcomes("g10-live-photo", ["g10-p-0001"]) })
      .toEqual({ discarded: ["g10-p-0001"], outcome: { "g10-p-0001": "withdrawn" } });
    await service.dispose();
  });

  it("P2-2: Stop does not wait for a direct command's handler", async () => {
    const { fake, service, ref } = await inboxService("g10-direct-command", { isStreaming: false });
    fake.session.extensionRunner.getRegisteredCommands = () => [{ invocationName: "ask-me" }];
    let releaseHandler = (): void => undefined;
    const handler = new Promise<void>((resolve) => { releaseHandler = resolve; });
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      await handler;
    };
    await service.prompt(ref, "/ask-me", undefined, undefined, { clientMessageId: "g10-cmd-001" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["/ask-me"]); });
    const stop = service.abort(ref);
    const answered = await Promise.race([stop.then(() => "stopped"), new Promise((resolve) => setTimeout(() => { resolve("stop still waiting on the handler"); }, 500))]);
    expect(answered).toBe("stopped");
    releaseHandler();
    await service.dispose();
  });
});

describe("a message the runtime refuses after the inbox accepted it (phase 2)", () => {
  it("tells the sender's row by identity, and the ledger says failed", async () => {
    const { fake, service, ref, hub } = await inboxService("p2-refused", { isStreaming: false });
    fake.session.prompt = () => Promise.reject(new Error("No model configured"));
    await service.prompt(ref, "refused after acceptance", undefined, undefined, { clientMessageId: "p2r-a-0001" });
    await vi.waitFor(() => { expect(hub.sessionEvents.map((entry) => entry.event.type)).toContain("prompt.refused"); });
    expect({
      frame: hub.sessionEvents.map((entry) => entry.event).find((event) => event.type === "prompt.refused"),
      outcome: service.operationOutcomes("p2-refused", ["p2r-a-0001"]),
    }).toEqual({
      frame: { type: "prompt.refused", clientMessageId: "p2r-a-0001", message: "No model configured" },
      outcome: { "p2r-a-0001": "failed" },
    });
    await service.dispose();
  });

  it("does not call a message refused once the agent read it, when its run fails afterwards", async () => {
    const { fake, service, ref, hub } = await inboxService("p2-read-then-failed", { isStreaming: false });
    fake.session.prompt = async (text: string, options?: PromptOptions) => {
      options?.preflightResult?.("started");
      fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text }] } });
      await Promise.resolve();
      throw new Error("provider went away mid-run");
    };
    await service.prompt(ref, "read, then the run failed", undefined, undefined, { clientMessageId: "p2r-b-0001" });
    await vi.waitFor(() => { expect(hub.sessionEvents.map((entry) => entry.event.type)).toContain("session.error"); });
    expect({
      refusedFrames: hub.sessionEvents.filter((entry) => entry.event.type === "prompt.refused").length,
      outcome: service.operationOutcomes("p2-read-then-failed", ["p2r-b-0001"]),
    }).toEqual({ refusedFrames: 0, outcome: { "p2r-b-0001": "succeeded" } });
    await service.dispose();
  });
});
