/* eslint-disable @typescript-eslint/no-unsafe-return -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { OwnedPromptQueue } from "./ownedPromptQueue.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Review lane "ordering": daemon acceptance and consumption.
 * Each test states an invariant from the owner mandate and fails on current code.
 */

const refs = new Map<string, string>();
const ref = (id: string) => sessionRef(id, refs.get(id));
const settle = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms));

async function service(sessionId: string, options: { isStreaming?: boolean; dir?: string; ledgerDir?: string } = {}) {
  const dir = options.dir ?? await mkdtemp(join(tmpdir(), "order-"));
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, { isStreaming: options.isStreaming ?? true });
  Reflect.set(fake.runtime, "cwd", dir);
  fake.session.sessionManager.getCwd = () => dir;
  const svc = new PiSessionService(hub, {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId, dir)]),
    heartbeatIntervalMs: 60_000,
    ...(options.ledgerDir === undefined ? {} : { operationLedgerDir: options.ledgerDir }),
  });
  refs.set(sessionId, dir);
  return { hub, fake, svc, dir };
}

describe("ordering lane repros", () => {
  it("I1: a prompt that arrives as the run settles does not overtake a parked prompt accepted earlier", async () => {
    const { fake, svc } = await service("idle-bypass");
    await svc.prompt(ref("idle-bypass"), "P1 parked while the agent ran", undefined, undefined, { clientMessageId: "p1" });
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await svc.prompt(ref("idle-bypass"), "P2 sent after the run went quiet", undefined, undefined, { clientMessageId: "p2" });
    await settle();
    const handed = fake.calls.prompt.map((call) => call.text);
    expect(handed).toEqual(["P1 parked while the agent ran", "P2 sent after the run went quiet"]);
    await svc.dispose();
  });

  it("I1: a refused drain does not let the next idle prompt jump the parked queue", async () => {
    const { fake, svc } = await service("refused-drain");
    await svc.prompt(ref("refused-drain"), "P1 parked", undefined, undefined, { clientMessageId: "p1" });
    let refuseOnce = true;
    const consumed: string[] = [];
    fake.session.prompt = (text: string) => {
      if (refuseOnce) { refuseOnce = false; return Promise.reject(new Error("Agent is already processing a prompt.")); }
      consumed.push(text);
      return Promise.resolve();
    };
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await settle();
    await svc.prompt(ref("refused-drain"), "P2 sent next", undefined, undefined, { clientMessageId: "p2" });
    await settle();
    expect(consumed).toEqual(["P1 parked", "P2 sent next"]);
    await svc.dispose();
  });

  it("I1: a prompt accepted during compaction does not reach the runtime before a prompt parked before the compaction", async () => {
    const { fake, svc } = await service("compaction-overtake");
    await svc.prompt(ref("compaction-overtake"), "P1 parked before compaction", undefined, undefined, { clientMessageId: "p1" });
    fake.session.isCompacting = true;
    await svc.prompt(ref("compaction-overtake"), "P2 sent during compaction", undefined, undefined, { clientMessageId: "p2" });
    fake.session.isCompacting = false;
    fake.emit({ type: "compaction_end" });
    await settle();
    const handed = fake.calls.prompt.map((call) => call.text);
    const stillParked = (await svc.status(ref("compaction-overtake"))).queuedMessages.map((entry) => entry.clientMessageId);
    expect({ handed, stillParked }).toEqual({ handed: ["P1 parked before compaction", "P2 sent during compaction"], stillParked: [] });
    await svc.dispose();
  });

  it("I4: a refused submission leaves no identity behind for a later message with the same text to inherit", async () => {
    const { fake, svc } = await service("stale-stamp", { isStreaming: false });
    let refuseOnce = true;
    fake.session.prompt = () => {
      if (refuseOnce) { refuseOnce = false; return Promise.reject(new Error("No model selected.")); }
      return Promise.resolve();
    };
    await svc.prompt(ref("stale-stamp"), "continue", undefined, undefined, { clientMessageId: "x-refused" });
    await settle(50);
    await svc.prompt(ref("stale-stamp"), "continue", undefined, undefined, { clientMessageId: "y-delivered" });
    await settle(50);
    const committed: Record<string, unknown> = { role: "user", content: [{ type: "text", text: "continue" }] };
    fake.emit({ type: "message_start", message: committed });
    expect(committed["clientMessageId"]).toBe("y-delivered");
    await svc.dispose();
  });

  it("I3: an accepted steer held only in the runtime queue survives a daemon restart, or is not reported succeeded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "order-restart-"));
    const ledgerDir = await mkdtemp(join(tmpdir(), "order-ledger-"));
    const first = await service("restart", { dir, ledgerDir });
    await first.svc.prompt(ref("restart"), "S1 steer while running", "steer", undefined, { clientMessageId: "steer-0001" });
    first.fake.emit({ type: "turn_end" });
    await settle(50);
    expect(first.fake.calls.prompt.map((call) => call.text)).toEqual(["S1 steer while running"]);
    await first.svc.dispose();

    const second = await service("restart", { dir, ledgerDir, isStreaming: false });
    const outcome = second.svc.operationOutcomes("restart", ["steer-0001"])["steer-0001"];
    await second.svc.prompt(ref("restart"), "S1 steer while running", "steer", undefined, { clientMessageId: "steer-0001" });
    await settle();
    const queued = (await second.svc.status(ref("restart"))).queuedMessages.map((entry) => entry.clientMessageId);
    const retryRan = second.fake.calls.prompt.length > 0;
    expect({ outcome, survives: queued.includes("steer-0001") || retryRan }).toEqual({ outcome: "unknown", survives: true });
    await second.svc.dispose();
  });

  it("I3: a message withdrawn by recall is not resurrected by an outbox retry of its id", async () => {
    const { fake, svc } = await service("recall-retry");
    await svc.prompt(ref("recall-retry"), "withdraw me", undefined, undefined, { clientMessageId: "w1" });
    const recalled = await svc.recallQueuedMessage(ref("recall-retry"), { text: "withdraw me", clientMessageId: "w1" });
    expect(recalled.recalled).toBe(true);
    await svc.prompt(ref("recall-retry"), "withdraw me", undefined, undefined, { clientMessageId: "w1" });
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await settle();
    const queued = (await svc.status(ref("recall-retry"))).queuedMessages.map((entry) => entry.clientMessageId);
    expect({ handed: fake.calls.prompt.map((call) => call.text), queued }).toEqual({ handed: [], queued: [] });
    await svc.dispose();
  });
  it("I1: the first prompt after a daemon restart does not overtake the prompts parked before it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "order-restore-"));
    const before = new OwnedPromptQueue();
    await before.open("restore-first", dir);
    await before.push("restore-first", dir, { clientMessageId: "parked-0001", lane: "followUp", text: "P1 parked before the restart", images: [], acceptedAt: new Date().toISOString(), echoUserMessage: true });
    const { fake, svc } = await service("restore-first", { dir, isStreaming: false, ledgerDir: await mkdtemp(join(tmpdir(), "order-restore-data-")) });
    await svc.prompt(ref("restore-first"), "P3 first message after the restart", undefined, undefined, { clientMessageId: "fresh-0003" });
    await settle();
    expect(fake.calls.prompt.map((call) => call.text)).toEqual(["P1 parked before the restart", "P3 first message after the restart"]);
    await svc.dispose();
  });
  it("I2: two requests that reach the daemon in order are accepted in that order", async () => {
    const { svc, hub } = await service("arrival-order");
    const png = (await readFile("docs/assets/pi-web-banner.png")).toString("base64");
    const first = svc.prompt(ref("arrival-order"), "A arrives first, with a photo", undefined, [{ kind: "image", mimeType: "image/png", data: png }], { clientMessageId: "arrive-0001" });
    const second = svc.prompt(ref("arrival-order"), "B arrives second", undefined, undefined, { clientMessageId: "arrive-0002" });
    await Promise.all([first, second]);
    const acceptedOrder = hub.sessionEvents.filter(({ event }) => event.type === "prompt.accepted").map(({ event }) => Reflect.get(event, "clientMessageId"));
    const queuedOrder = (await svc.status(ref("arrival-order"))).queuedMessages.map((entry) => entry.clientMessageId);
    expect({ acceptedOrder, queuedOrder }).toEqual({ acceptedOrder: ["arrive-0001", "arrive-0002"], queuedOrder: ["arrive-0001", "arrive-0002"] });
    await svc.dispose();
  });
  it("I1: a steer that arrives while recall rewrites the runtime queue does not land ahead of the older survivors", async () => {
    const { fake, svc } = await service("recall-window");
    const steering: string[] = [];
    let cleared!: () => void;
    const clearedSignal = new Promise<void>((resolve) => { cleared = resolve; });
    fake.session.prompt = async (text: string, options: unknown) => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      if (Reflect.get(Object(options), "streamingBehavior") === "steer") steering.push(text);
    };
    fake.session.clearQueue = () => { const taken = [...steering]; steering.length = 0; cleared(); return { steering: taken, followUp: [] }; };
    fake.session.getSteeringMessages = () => [...steering];
    await svc.prompt(ref("recall-window"), "S1 oldest", "steer", undefined, { clientMessageId: "steer-0001" });
    await svc.prompt(ref("recall-window"), "S2 older", "steer", undefined, { clientMessageId: "steer-0002" });
    await svc.prompt(ref("recall-window"), "S3 old", "steer", undefined, { clientMessageId: "steer-0003" });
    fake.emit({ type: "turn_end" });
    await settle(100);
    const recall = svc.recallQueuedMessage(ref("recall-window"), { kind: "steer", text: "S1 oldest", clientMessageId: "steer-0001" });
    await clearedSignal;
    await svc.prompt(ref("recall-window"), "S4 newest", "steer", undefined, { clientMessageId: "steer-0004" });
    await recall;
    fake.emit({ type: "turn_end" });
    await settle(100);
    expect(steering).toEqual(["S2 older", "S3 old", "S4 newest"]);
    await svc.dispose();
  });
  it("I6: a parked message whose text was sent once before is still reported as queued", async () => {
    const { fake, svc } = await service("repeat-text");
    Reflect.set(fake.session, "messages", [...fake.session.messages, { role: "user", content: [{ type: "text", text: "continue" }] }]);
    await svc.prompt(ref("repeat-text"), "continue", undefined, undefined, { clientMessageId: "again-0002" });
    const status = await svc.status(ref("repeat-text"));
    expect({ queued: status.queuedMessages.map((entry) => entry.clientMessageId), pending: status.pendingMessageCount }).toEqual({ queued: ["again-0002"], pending: 1 });
    await svc.dispose();
  });
  it("I3: a parked prompt whose drain was refused and restored is not run a second time by an outbox retry of its id", async () => {
    const { fake, svc } = await service("restored-retry");
    await svc.prompt(ref("restored-retry"), "P1 parked", undefined, undefined, { clientMessageId: "parked-0001" });
    let refuseOnce = true;
    const consumed: string[] = [];
    fake.session.prompt = (text: string) => {
      if (refuseOnce) { refuseOnce = false; return Promise.reject(new Error("Agent is already processing a prompt.")); }
      consumed.push(text);
      return Promise.resolve();
    };
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await settle();
    await svc.prompt(ref("restored-retry"), "P1 parked", undefined, undefined, { clientMessageId: "parked-0001" });
    await settle();
    fake.emit({ type: "agent_settled" });
    await settle();
    expect(consumed).toEqual(["P1 parked"]);
    await svc.dispose();
  });
});
