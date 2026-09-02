import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

/**
 * A prompt held through a compaction keeps the identity its sender gave it.
 *
 * The browser mints an id so it can mark its own bubble rather than have the
 * transcript draw the message a second time. A prompt sent while the session is
 * compacting is parked, and the park does carry the id - but the drain used to
 * re-submit it without one, and published a status against the emptied queue
 * first, which pruned the correlation record as well. The sender's claim was
 * gone twice over, so the message was drawn once by the sender and once by the
 * transcript: the duplicate this project has now chased through four separate
 * producers.
 *
 * These assertions are on the service, not on the correlation helper. The
 * helper was already covered and stayed green while the drain dropped the id
 * on the floor, which is how this path survived the previous fix.
 */

function compactingService(sessionId: string) {
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, { isCompacting: true });
  fake.session.prompt = (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => {
    fake.calls.prompt.push({ text, options });
    return Promise.resolve();
  };
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    heartbeatIntervalMs: 60_000,
  });
  return { hub, fake, service };
}

describe("a prompt parked by a compaction", () => {
  it("still carries its sender's id after the queue drains", async () => {
    const { fake, hub, service } = compactingService("compaction-identity");

    await service.prompt(sessionRef("compaction-identity"), "hello", "followUp", undefined, { clientMessageId: "c-1" });

    await expect(service.status(sessionRef("compaction-identity"))).resolves.toMatchObject({
      queuedMessages: [{ text: "hello", clientMessageId: "c-1" }],
    });

    fake.session.isCompacting = false;
    fake.emit({ type: "compaction_end" });
    await vi.waitFor(() => { expect(fake.calls.prompt.length).toBe(1); });

    // The echo is the sender's proof that this row is its own. Published
    // without an id, the browser cannot claim its bubble and the transcript
    // draws the message a second time.
    const echoes = hub.sessionEvents.filter(({ event }) => Reflect.get(event, "type") === "message.append" && Reflect.get(event, "echo") === true);
    expect(echoes.length).toBeGreaterThan(0);
    expect(echoes.every(({ event }) => Reflect.get(event, "clientMessageId") === "c-1")).toBe(true);
  });

  /**
   * The attachment-only case, which is where the loss is guaranteed rather than
   * likely: with no text there is nothing to fall back on once the id is gone.
   */
  it("keeps the id of a prompt that carries no words", async () => {
    const { service } = compactingService("compaction-identity-empty");

    await service.prompt(sessionRef("compaction-identity-empty"), "", "followUp", undefined, { clientMessageId: "c-empty" });

    await expect(service.status(sessionRef("compaction-identity-empty"))).resolves.toMatchObject({
      queuedMessages: [{ clientMessageId: "c-empty" }],
    });
  });
});
