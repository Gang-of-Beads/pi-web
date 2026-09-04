import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

/**
 * A recall deletes the daemon's queue entry, so no transcript claim is ever
 * coming for that identity. Another device knows nothing of the click: without
 * a withdrawal frame its row waits at "Queued" forever, and a retry would
 * re-send what the reader explicitly took back. The frame carries the id and
 * rides the ring like every other session frame.
 */
function busyService(sessionId: string, queue: { steering: string[]; followUp: string[] }) {
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, {
    isStreaming: true,
    pendingMessageCount: queue.steering.length + queue.followUp.length,
    getSteeringMessages: () => queue.steering,
    getFollowUpMessages: () => queue.followUp,
  });
  const cwd = join(tmpdir(), `pi-web-withdraw-${randomUUID()}`);
  fake.session.sessionManager.getCwd = () => cwd;
  Reflect.set(fake.runtime, "cwd", cwd);
  fake.session.clearQueue = vi.fn(() => {
    const cleared = { steering: [...queue.steering], followUp: [...queue.followUp] };
    queue.steering.length = 0;
    queue.followUp.length = 0;
    return cleared;
  });
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId, cwd)]),
    heartbeatIntervalMs: 60_000,
  });
  return { hub, fake, service };
}

function withdrawnIds(hub: CapturingSessionEventHub): string[] {
  return hub.sessionEvents
    .filter(({ event }) => Reflect.get(event, "type") === "prompt.withdrawn")
    .map(({ event }) => String(Reflect.get(event, "clientMessageId")));
}

describe("a recall tells every device the message was taken back", () => {
  it("publishes the withdrawn identity when a queued message is recalled", async () => {
    const queue = { steering: ["take me back"], followUp: [] };
    const { hub, service } = busyService("withdraw-recall", queue);
    await service.prompt(sessionRef("withdraw-recall"), "take me back", "steer", undefined, { clientMessageId: "c-recall" });

    await service.recallQueuedMessage(sessionRef("withdraw-recall"), { kind: "steer", text: "take me back", clientMessageId: "c-recall" });

    expect(withdrawnIds(hub)).toEqual(["c-recall"]);
    await service.dispose();
  });

  it("publishes nothing for a recall that found the message already gone", async () => {
    const queue = { steering: [], followUp: [] };
    const { hub, service } = busyService("withdraw-miss", queue);

    await service.recallQueuedMessage(sessionRef("withdraw-miss"), { text: "already taken" });

    expect(withdrawnIds(hub)).toEqual([]);
    await service.dispose();
  });

  it("withdraws the discarded identities when the turn is stopped", async () => {
    const queue = { steering: [], followUp: ["waiting for a turn"] };
    const { hub, fake, service } = busyService("withdraw-abort", queue);
    await service.prompt(sessionRef("withdraw-abort"), "waiting for a turn", "followUp", undefined, { clientMessageId: "c-stop" });

    await service.abort(sessionRef("withdraw-abort", fake.runtime.cwd));

    expect(withdrawnIds(hub)).toEqual(["c-stop"]);
    await service.dispose();
  });

  it("does not withdraw an identity whose message the agent already took", async () => {
    // In the owned-queue model delivery removes the entry, so a drained
    // prompt has nothing left to withdraw - clearing afterwards says nothing.
    const queue = { steering: [], followUp: [] };
    const { hub, fake, service } = busyService("withdraw-consumed", queue);
    await service.prompt(sessionRef("withdraw-consumed"), "already taken", "followUp", undefined, { clientMessageId: "c-taken" });
    fake.session.isStreaming = false;
    fake.emit({ type: "agent_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt.map((call) => call.text)).toEqual(["already taken"]); });

    await service.clearQueue(sessionRef("withdraw-consumed"));

    expect(withdrawnIds(hub)).toEqual([]);
    await service.dispose();
  });

  it("withdraws every known identity when the whole queue is cleared", async () => {
    const queue = { steering: ["first"], followUp: ["second"] };
    const { hub, service } = busyService("withdraw-clear", queue);
    await service.prompt(sessionRef("withdraw-clear"), "first", "steer", undefined, { clientMessageId: "c-1" });
    await service.prompt(sessionRef("withdraw-clear"), "second", "followUp", undefined, { clientMessageId: "c-2" });

    await service.clearQueue(sessionRef("withdraw-clear"));

    expect(withdrawnIds(hub).sort()).toEqual(["c-1", "c-2"]);
    await service.dispose();
  });
});
