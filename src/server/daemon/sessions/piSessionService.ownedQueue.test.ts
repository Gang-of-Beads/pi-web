import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { OwnedPromptQueue, queueFilePath } from "./ownedPromptQueue.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

async function busyService(sessionId: string, cwd?: string) {
  const dir = cwd ?? await mkdtemp(join(tmpdir(), "ownedq-"));
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, { isStreaming: true });
  Reflect.set(fake.runtime, "cwd", dir);
  fake.session.sessionManager.getCwd = () => dir;
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    heartbeatIntervalMs: 60_000,
  });
  return { hub, fake, service, dir };
}

describe("the daemon owns the queue", () => {
  it("parks a busy follow-up durably instead of handing it to the runtime", async () => {
    const { fake, service, dir } = await busyService("own-park");
    await service.prompt(sessionRef("own-park"), "later please", "followUp", undefined, { clientMessageId: "c-park" });

    expect(fake.calls.prompt).toHaveLength(0);
    expect(existsSync(queueFilePath(dir, "own-park"))).toBe(true);
    const status = await service.status(sessionRef("own-park"));
    expect(status.queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["c-park"]);
    await service.dispose();
  });

  it("does not accept or echo a parked prompt that failed its durable write", async () => {
    const { fake, hub, service, dir } = await busyService("own-persist-failure");
    await writeFile(join(dir, ".pi"), "not a directory");

    await expect(service.prompt(sessionRef("own-persist-failure"), "must remain in the outbox", "followUp", undefined, { clientMessageId: "c-fail" }))
      .rejects.toThrow();

    expect(fake.calls.prompt).toHaveLength(0);
    expect((await service.status(sessionRef("own-persist-failure"))).queuedMessages).toEqual([]);
    expect(hub.sessionEvents.map(({ event }) => event.type)).not.toContain("prompt.accepted");
    expect(hub.sessionEvents.map(({ event }) => event.type)).not.toContain("message.append");
    await service.dispose();
  });

  it("drains the parked prompt when the runtime settles, as a direct send", async () => {
    const { fake, service } = await busyService("own-drain");
    await service.prompt(sessionRef("own-drain"), "later please", "followUp", undefined, { clientMessageId: "c-drain" });

    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["later please"]); });
    await service.dispose();
  });

  it("drains even though agent_end fires while isStreaming is still true, via agent_settled", async () => {
    // The real SDK re-broadcasts agent_end from inside the running loop and
    // clears isStreaming only afterwards, with agent_settled; a drain gated on
    // the flag at agent_end time never fires. The reviewers proved the old
    // test passed only because the fake flipped the flag by hand first.
    const { fake, service } = await busyService("own-settle");
    await service.prompt(sessionRef("own-settle"), "after the settle", "followUp", undefined, { clientMessageId: "c-settle" });

    fake.emit({ type: "agent_end" });
    expect(fake.calls.prompt).toHaveLength(0);
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["after the settle"]); });
    await service.dispose();
  });

  it("drains queued entries one settle at a time, re-arming while entries remain", async () => {
    const { fake, service } = await busyService("own-two");
    await service.prompt(sessionRef("own-two"), "first parked", "followUp", undefined, { clientMessageId: "c-two-1" });
    await service.prompt(sessionRef("own-two"), "second parked", "followUp", undefined, { clientMessageId: "c-two-2" });

    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["first parked", "second parked"]); });
    await service.dispose();
  });

  it("restores the entry when the runtime refuses the drained submission", async () => {
    const { fake, service, dir } = await busyService("own-refuse");
    await service.prompt(sessionRef("own-refuse"), "refused once", "followUp", undefined, { clientMessageId: "c-refuse" });

    fake.session.prompt = () => { throw new Error("Agent is already processing"); };
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_settled" });
    await vi.waitFor(async () => {
      const status = await service.status(sessionRef("own-refuse"));
      expect(status.queuedMessages.map((entry) => entry.clientMessageId)).toEqual(["c-refuse"]);
    });
    await vi.waitFor(() => { expect(existsSync(queueFilePath(dir, "own-refuse"))).toBe(true); });
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

  it("delivers a busy steer immediately rather than parking it", async () => {
    const { fake, service, dir } = await busyService("own-steer");
    await service.prompt(sessionRef("own-steer"), "turn left", "steer", undefined, { clientMessageId: "c-steer" });

    expect(fake.calls.prompt.map((call) => call.text)).toEqual(["turn left"]);
    expect(existsSync(queueFilePath(dir, "own-steer"))).toBe(false);
    await service.dispose();
  });

  it("recalls a parked prompt by id and publishes the withdrawal", async () => {
    const { hub, service, dir } = await busyService("own-recall");
    await service.prompt(sessionRef("own-recall"), "take me back", "followUp", undefined, { clientMessageId: "c-back" });

    await service.recallQueuedMessage(sessionRef("own-recall"), { kind: "followUp", text: "take me back", clientMessageId: "c-back" });

    expect(existsSync(queueFilePath(dir, "own-recall"))).toBe(false);
    const withdrawn = hub.sessionEvents.filter(({ event }) => Reflect.get(event, "type") === "prompt.withdrawn");
    expect(withdrawn).toHaveLength(1);
    await service.dispose();
  });

  it("treats an outbox retry of a restored id as a duplicate after restart", async () => {
    const first = await busyService("own-idem");
    await first.service.prompt(sessionRef("own-idem"), "only once", "followUp", undefined, { clientMessageId: "c-idem" });
    await first.service.dispose();

    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("own-idem", { isStreaming: true });
    Reflect.set(fake.runtime, "cwd", first.dir);
    fake.session.sessionManager.getCwd = () => first.dir;
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("own-idem")]),
      heartbeatIntervalMs: 60_000,
    });
    // Opening the session does not return until its durable queue has restored
    // the acceptance ledger, so a retry in the first request after restart is
    // still a duplicate rather than a second execution.
    await service.status(sessionRef("own-idem"));
    await service.prompt(sessionRef("own-idem"), "only once", "followUp", undefined, { clientMessageId: "c-idem" });

    expect((await service.status(sessionRef("own-idem"))).queuedMessages).toHaveLength(1);
    expect(fake.calls.prompt).toHaveLength(0);
    await service.dispose();
  });

  it("survives a daemon restart: the parked prompt reloads and drains", async () => {
    const first = await busyService("own-restart");
    await first.service.prompt(sessionRef("own-restart"), "after the crash", "followUp", undefined, { clientMessageId: "c-crash" });
    await first.service.dispose();

    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("own-restart");
    Reflect.set(fake.runtime, "cwd", first.dir);
    fake.session.sessionManager.getCwd = () => first.dir;
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("own-restart")]),
      heartbeatIntervalMs: 60_000,
    });
    await service.status(sessionRef("own-restart"));
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["after the crash"]); });
    await service.dispose();
  });
});
