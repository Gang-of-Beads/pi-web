import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
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
    else promptOptions?.preflightResult?.(true);
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
    fake.session.prompt = (text: string, options?: PromptOptions) => {
      fake.calls.prompt.push({ text, options });
      if (options?.streamingBehavior === "steer" && fake.session.isStreaming) {
        lane.push(text);
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
