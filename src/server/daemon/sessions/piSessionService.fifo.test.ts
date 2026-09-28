import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * A session consumes its messages in the order the daemon accepted them.
 *
 * Reproduces the owner's session 01a04701 on 2026-09-28, from the daemon's own records:
 * bb91254c was accepted at 23:05:00 while the agent was running, carrying no delivery
 * kind (the browser's outbox replayed it with the kind it froze while the phone showed
 * "idle"). It was parked as a follow-up in the owned queue; 687c683b, accepted at 23:05:14
 * with "steer", went straight to the runtime and reached the agent at 23:05:17, as did the
 * four messages after it, while bb91254c stayed on disk.
 */
describe("message order", () => {
  it.fails("hands a later steer to the runtime only after an earlier message accepted while busy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fifo-"));
    const fake = fakeRuntime("fifo", { isStreaming: true });
    Reflect.set(fake.runtime, "cwd", dir);
    fake.session.sessionManager.getCwd = () => dir;
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("fifo")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("fifo"), "first: sent with no kind while the agent runs", undefined, undefined, { clientMessageId: "bb91254c" });
    await service.prompt(sessionRef("fifo"), "second: sent as steer", "steer", undefined, { clientMessageId: "687c683b" });
    fake.emit({ type: "turn_end" });
    await new Promise((resolve) => setTimeout(resolve, 200));

    const handed = fake.calls.prompt.map((call) => call.text);
    const stillQueued = (await service.status(sessionRef("fifo"))).queuedMessages.map((entry) => entry.clientMessageId);
    expect({ handed, stillQueued }).toEqual({
      handed: ["first: sent with no kind while the agent runs", "second: sent as steer"],
      stillQueued: [],
    });
    await service.dispose();
  });
});
