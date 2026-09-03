import { mkdtemp } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { queueFilePath } from "./ownedPromptQueue.js";
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

  it("drains the parked prompt when the runtime settles, as a direct send", async () => {
    const { fake, service } = await busyService("own-drain");
    await service.prompt(sessionRef("own-drain"), "later please", "followUp", undefined, { clientMessageId: "c-drain" });

    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["later please"]); });
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
