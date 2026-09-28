import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { OwnedPromptQueue } from "./ownedPromptQueue.js";
import { CapturingSessionEventHub, fakeRuntime, handedAs, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Pins the fixes from the phase 1 review of the daemon inbox (docs/design/state-sync-redesign.md,
 * "Phase 1 review triage"). The fake runtime here keeps a real steering lane, removes a steer
 * from it when the agent reads it, and calls preflight the way the SDK does.
 */
interface PromptOptions { streamingBehavior?: "steer" | "followUp"; preflightResult?: (success: boolean) => void }

async function inboxService(sessionId: string, options: { dataDir?: string; dir?: string; isStreaming?: boolean } = {}) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), "inbox-review-"));
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), "inbox-review-data-"));
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, { isStreaming: options.isStreaming ?? true });
  Reflect.set(fake.runtime, "cwd", dir);
  fake.session.sessionManager.getCwd = () => dir;
  const lane: string[] = [];
  fake.session.getSteeringMessages = () => [...lane];
  fake.session.clearQueue = () => {
    fake.calls.clearQueue += 1;
    const steering = [...lane];
    lane.length = 0;
    return { steering, followUp: [] };
  };
  fake.session.prompt = (text: string, promptOptions?: PromptOptions) => {
    fake.calls.prompt.push({ text, options: promptOptions });
    if (promptOptions?.streamingBehavior === "steer" && fake.session.isStreaming) lane.push(text);
    promptOptions?.preflightResult?.(true);
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
    fake.emit({ type: "message_start", message: { role: "user", content: [{ type: "text", text: committedText }] } });
  };
  return { hub, fake, service, ref, dir, dataDir, lane, readSteer };
}

const texts = (calls: { text: string }[]) => calls.map((call) => call.text);

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
      options?.preflightResult?.(true);
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
    await service.prompt(ref, "A newer", undefined, undefined, { clientMessageId: "o2-a-0001" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts(fake.calls.prompt)).toEqual(["S stranded"]);

    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["S stranded", "S stranded", "A newer"]); });
    expect(fake.calls.prompt.map(handedAs)).toEqual(["steer", undefined, undefined]);
    await service.dispose();
  });
});

describe("a direct prompt refused after preflight keeps its place (O3)", () => {
  it("puts the message back at the head when another run started during its preflight, and hands it later", async () => {
    const { fake, service, ref } = await inboxService("o3-race", { isStreaming: false });
    let refuse = true;
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      options?.preflightResult?.(true);
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
      options?.preflightResult?.(true);
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
        options.preflightResult?.(true);
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
      options?.preflightResult?.(true);
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
      options?.preflightResult?.(true);
    };
    await service.prompt(ref, "A", undefined, undefined, { clientMessageId: "f2-a-0001" });
    await service.prompt(ref, "B", undefined, undefined, { clientMessageId: "f2-b-0001" });
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A"]); });
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(texts(fake.calls.prompt)).toEqual(["A"]);
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(texts(fake.calls.prompt)).toEqual(["A", "A", "B"]); });
    expect(fake.calls.prompt.map(handedAs)).toEqual(["steer", undefined, undefined]);
    await service.dispose();
  });

  it("F2: never puts back a message the agent already read, whatever its promise says later", async () => {
    const { fake, service, ref } = await inboxService("f2-committed", { isStreaming: false });
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      options?.preflightResult?.(true);
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
        options?.preflightResult?.(true);
        return Promise.resolve();
      }
      refuse = false;
      agentState.isStreaming = true;
      options?.preflightResult?.(true);
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
      options?.preflightResult?.(true);
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
      options?.preflightResult?.(true);
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
      options?.preflightResult?.(true);
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
