import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDurableAcceptanceLedger } from "./operationLedger.js";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/** Review lane "ordering": exactly-once guarantees of the durable acceptance face. */
describe("acceptance ledger repros", () => {
  it.fails("I3: the 513th accepted prompt of a session is still remembered as accepted", async () => {
    const ledger = createDurableAcceptanceLedger(await mkdtemp(join(tmpdir(), "ledger-cap-")));
    for (let index = 0; index < 512; index += 1) ledger.record("s", `prompt-${String(index).padStart(6, "0")}`);
    ledger.record("s", "prompt-000512");
    expect(ledger.has("s", "prompt-000512")).toBe(true);
  });

  it.fails("I3: stopping a session does not turn an outbox retry of an already-run prompt into a second run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-stop-"));
    const fake = fakeRuntime("stop-forget", { isStreaming: false });
    Reflect.set(fake.runtime, "cwd", dir);
    fake.session.sessionManager.getCwd = () => dir;
    const svc = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: "/tmp/pi-web-test-agent",
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("stop-forget", dir)]),
      heartbeatIntervalMs: 60_000,
      operationLedgerDir: await mkdtemp(join(tmpdir(), "ledger-stop-dir-")),
    });
    await svc.prompt(sessionRef("stop-forget", dir), "run once", undefined, undefined, { clientMessageId: "once-0001" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    await svc.stop(sessionRef("stop-forget", dir));
    await svc.prompt(sessionRef("stop-forget", dir), "run once", undefined, undefined, { clientMessageId: "once-0001" });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.calls.prompt.map((call) => call.text)).toEqual(["run once"]);
    await svc.dispose();
  });
});
