import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { OwnedPromptQueue, dataDirInboxLocation, inboxDirectory } from "./ownedPromptQueue.js";
import { CapturingSessionEventHub, fakeRuntime, handedAs, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

function inboxFile(dataDir: string, sessionId: string): string {
  return dataDirInboxLocation(dataDir)(sessionId, "") ?? "";
}

async function busyService(sessionId: string, options: { dataDir?: string; isStreaming?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "ownedq-"));
  const dataDir = options.dataDir ?? await mkdtemp(join(tmpdir(), "ownedq-data-"));
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, { isStreaming: options.isStreaming ?? true });
  Reflect.set(fake.runtime, "cwd", dir);
  fake.session.sessionManager.getCwd = () => dir;
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    heartbeatIntervalMs: 60_000,
    operationLedgerDir: dataDir,
  });
  return { hub, fake, service, dir, dataDir };
}

describe("the daemon owns the queue", () => {
  it("holds a message sent while the agent runs durably instead of handing it to the runtime", async () => {
    const { fake, service, dataDir } = await busyService("own-park");
    await service.prompt(sessionRef("own-park"), "later please", "followUp", undefined, { clientMessageId: "c-park" });

    expect(fake.calls.prompt).toHaveLength(0);
    expect(existsSync(inboxFile(dataDir, "own-park"))).toBe(true);
    const status = await service.status(sessionRef("own-park"));
    expect(status.queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["c-park"]);
    await service.dispose();
  });

  it("does not accept or echo a message whose durable write failed", async () => {
    const { fake, hub, service, dataDir } = await busyService("own-persist-failure");
    await writeFile(inboxDirectory(dataDir), "not a directory");

    await expect(service.prompt(sessionRef("own-persist-failure"), "must remain in the outbox", "followUp", undefined, { clientMessageId: "c-fail" }))
      .rejects.toThrow();

    expect(fake.calls.prompt).toHaveLength(0);
    expect((await service.status(sessionRef("own-persist-failure"))).queuedMessages).toEqual([]);
    expect(hub.sessionEvents.map(({ event }) => event.type)).not.toContain("prompt.accepted");
    expect(hub.sessionEvents.map(({ event }) => event.type)).not.toContain("message.append");
    await service.dispose();
  });

  it("does not need the workspace to be writable", async () => {
    const { fake, service, dir } = await busyService("own-readonly-workspace", { isStreaming: false });
    await writeFile(join(dir, ".pi"), "not a directory");

    await service.prompt(sessionRef("own-readonly-workspace"), "still accepted", undefined, undefined, { clientMessageId: "c-ro" });

    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["still accepted"]); });
    await service.dispose();
  });

  it("hands the held message as a direct send when the runtime settles", async () => {
    const { fake, service } = await busyService("own-drain");
    await service.prompt(sessionRef("own-drain"), "later please", "followUp", undefined, { clientMessageId: "c-drain" });

    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["later please"]); });
    expect(fake.calls.prompt[0]?.options).not.toHaveProperty("streamingBehavior");
    await service.dispose();
  });

  it("hands everything waiting at a gap, in order, as steers", async () => {
    const { fake, service, dataDir } = await busyService("own-steer");
    await service.prompt(sessionRef("own-steer"), "first", "followUp", undefined, { clientMessageId: "c-steer-1" });
    await service.prompt(sessionRef("own-steer"), "turn left", "steer", undefined, { clientMessageId: "c-steer-2" });
    expect(fake.calls.prompt).toHaveLength(0);

    fake.emit({ type: "turn_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["first", "turn left"]); });
    expect(fake.calls.prompt.map(handedAs)).toEqual(["steer", "steer"]);
    expect(existsSync(inboxFile(dataDir, "own-steer"))).toBe(false);
    await service.dispose();
  });

  it("hands the next held message once the previous direct send is the runtime's", async () => {
    const { fake, service } = await busyService("own-two");
    await service.prompt(sessionRef("own-two"), "first parked", "followUp", undefined, { clientMessageId: "c-two-1" });
    await service.prompt(sessionRef("own-two"), "second parked", "followUp", undefined, { clientMessageId: "c-two-2" });

    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["first parked", "second parked"]); });
    await service.dispose();
  });

  it("keeps the entry at the head when the runtime is momentarily busy", async () => {
    const { fake, service, dataDir } = await busyService("own-refuse");
    await service.prompt(sessionRef("own-refuse"), "refused once", "followUp", undefined, { clientMessageId: "c-refuse" });

    fake.session.prompt = () => { throw new Error("Agent is already processing"); };
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(async () => {
      const status = await service.status(sessionRef("own-refuse"));
      expect(status.queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["c-refuse"]);
    });
    await vi.waitFor(() => { expect(existsSync(inboxFile(dataDir, "own-refuse"))).toBe(true); });
    await service.dispose();
  });

  it("parks one copy when the same id is pushed twice across a ledger gap", async () => {
    const { service } = await busyService("own-dedupe");
    await service.prompt(sessionRef("own-dedupe"), "only one copy", "followUp", undefined, { clientMessageId: "c-dup" });
    const queue: unknown = Reflect.get(service, "ownedQueue");
    if (!(queue instanceof OwnedPromptQueue)) throw new Error("ownedQueue unavailable");
    await queue.push("own-dedupe", "/tmp", { clientMessageId: "c-dup", lane: "followUp", text: "only one copy", images: [], acceptedAt: "", echoUserMessage: true });

    expect(queue.entries("own-dedupe")).toHaveLength(1);
    await service.dispose();
  });

  it("recalls a held message by id and publishes the withdrawal", async () => {
    const { hub, service, dataDir } = await busyService("own-recall");
    await service.prompt(sessionRef("own-recall"), "take me back", "followUp", undefined, { clientMessageId: "c-back" });

    await service.recallQueuedMessage(sessionRef("own-recall"), { kind: "followUp", text: "take me back", clientMessageId: "c-back" });

    expect(existsSync(inboxFile(dataDir, "own-recall"))).toBe(false);
    const withdrawn = hub.sessionEvents.filter(({ event }) => Reflect.get(event, "type") === "prompt.withdrawn");
    expect(withdrawn).toHaveLength(1);
    await service.dispose();
  });

  it("treats an outbox retry of a restored id as a duplicate after restart", async () => {
    const first = await busyService("own-idem");
    await first.service.prompt(sessionRef("own-idem"), "only once", "followUp", undefined, { clientMessageId: "c-idem" });
    await first.service.dispose();

    const { fake, service } = await busyService("own-idem", { dataDir: first.dataDir });
    // Opening the session does not return until its durable queue has restored
    // the acceptance ledger, so a retry in the first request after restart is
    // still a duplicate rather than a second execution.
    await service.status(sessionRef("own-idem"));
    await service.prompt(sessionRef("own-idem"), "only once", "followUp", undefined, { clientMessageId: "c-idem" });

    expect((await service.status(sessionRef("own-idem"))).queuedMessages).toHaveLength(1);
    expect(fake.calls.prompt).toHaveLength(0);
    await service.dispose();
  });

  it("hands a waiting message after a restart without anyone opening the session", async () => {
    const first = await busyService("own-startup");
    await first.service.prompt(sessionRef("own-startup"), "nobody is watching", undefined, undefined, { clientMessageId: "c-startup" });
    await first.service.dispose();

    const { fake, service } = await busyService("own-startup", { dataDir: first.dataDir, isStreaming: false });
    Reflect.set(fake.runtime, "cwd", first.dir);
    fake.session.sessionManager.getCwd = () => first.dir;
    await expect(service.resumeWaitingInboxes()).resolves.toEqual(["own-startup"]);
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["nobody is watching"]); });
    await service.dispose();
  });

  it("lets pi take every waiting steer at one gap", async () => {
    const { fake, service } = await busyService("own-steering-mode");
    await service.status(sessionRef("own-steering-mode"));
    expect(fake.session.agent.steeringMode).toBe("all");
    await service.dispose();
  });

  it("survives a daemon restart: the held message reloads and is handed", async () => {
    const first = await busyService("own-restart");
    await first.service.prompt(sessionRef("own-restart"), "after the crash", "followUp", undefined, { clientMessageId: "c-crash" });
    await first.service.dispose();

    const { fake, service } = await busyService("own-restart", { dataDir: first.dataDir, isStreaming: false });
    await service.status(sessionRef("own-restart"));
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["after the crash"]); });
    await service.dispose();
  });
});
