import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Lane "confirm": the browser can put two POSTs for ONE message in flight.
 *
 * Probed live on 8505 (a held first POST plus a window `online` event): the
 * outbox replay resends the same message under the same clientMessageId while
 * the direct send is still in flight. The daemon, not the client, is what makes
 * that safe - `has()`/`record()` straddle `await parkPrompt` here, so the
 * ledger is the only thing standing between a slow first POST and a second copy.
 */
describe("two concurrent requests under one identity", () => {
  it("parks the message once", async () => {
    const dir = await mkdtemp(join(tmpdir(), "dup-"));
    const fake = fakeRuntime("dup", { isStreaming: true });
    Reflect.set(fake.runtime, "cwd", dir);
    fake.session.sessionManager.getCwd = () => dir;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("dup")]),
      heartbeatIntervalMs: 60_000,
    });
    const first = service.prompt(sessionRef("dup"), "the same message", "followUp", undefined, { clientMessageId: "same-id" });
    const second = service.prompt(sessionRef("dup"), "the same message", "followUp", undefined, { clientMessageId: "same-id" });
    await Promise.all([first, second]);
    const queued = (await service.status(sessionRef("dup"))).queuedMessages.map((entry) => entry.clientMessageId);
    expect(queued).toEqual(["same-id"]);
    await service.dispose();
  });
});
