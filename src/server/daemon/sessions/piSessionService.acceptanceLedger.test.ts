import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";
import { AcceptanceLedger } from "./acceptanceLedger.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

/**
 * The browser retries from its outbox with the same id whenever a response was
 * lost. Whether the first attempt arrived is exactly what the sender cannot
 * know, so the daemon must answer the repeat instead of running it twice. The
 * queue records forget an id the moment the prompt is consumed - the normal
 * fate of a prompt accepted while idle - which is why the previous dedupe
 * could not close this: it only knew identities still queued.
 */
function idleService(sessionId: string) {
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId, {});
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

describe("a repeated identity answers instead of running twice", () => {
  it("runs a direct-path prompt once however often its id is retried", async () => {
    const { fake, service } = idleService("ledger-direct");

    await service.prompt(sessionRef("ledger-direct"), "hello", undefined, undefined, { clientMessageId: "c-1" });
    await service.prompt(sessionRef("ledger-direct"), "hello", undefined, undefined, { clientMessageId: "c-1" });
    await service.prompt(sessionRef("ledger-direct"), "hello", undefined, undefined, { clientMessageId: "c-1" });

    expect(fake.calls.prompt).toHaveLength(1);
  });

  it("repeats the acceptance frame so the sender's outbox can settle", async () => {
    const { fake, hub, service } = idleService("ledger-frame");

    await service.prompt(sessionRef("ledger-frame"), "hello", undefined, undefined, { clientMessageId: "c-1" });
    await service.prompt(sessionRef("ledger-frame"), "hello", undefined, undefined, { clientMessageId: "c-1" });

    const accepted = hub.sessionEvents.filter(({ event }) => Reflect.get(event, "type") === "prompt.accepted");
    expect(accepted).toHaveLength(2);
    expect(fake.calls.prompt).toHaveLength(1);
  });

  it("never swallows a deliberate resend, which carries a fresh id", async () => {
    const { fake, service } = idleService("ledger-fresh");

    await service.prompt(sessionRef("ledger-fresh"), "continue", undefined, undefined, { clientMessageId: "c-1" });
    await service.prompt(sessionRef("ledger-fresh"), "continue", undefined, undefined, { clientMessageId: "c-2" });

    expect(fake.calls.prompt).toHaveLength(2);
  });

  it("leaves id-less prompts alone", async () => {
    const { fake, service } = idleService("ledger-anonymous");

    await service.prompt(sessionRef("ledger-anonymous"), "hello");
    await service.prompt(sessionRef("ledger-anonymous"), "hello");

    expect(fake.calls.prompt).toHaveLength(2);
  });
});

describe("the ledger itself", () => {
  it("stays bounded, dropping the oldest identity past the limit", () => {
    const ledger = new AcceptanceLedger(3);
    for (const id of ["a", "b", "c", "d"]) ledger.record("s", id);
    expect(ledger.has("s", "a")).toBe(false);
    expect(ledger.has("s", "b")).toBe(true);
    expect(ledger.has("s", "d")).toBe(true);
  });

  it("keeps sessions apart", () => {
    const ledger = new AcceptanceLedger();
    ledger.record("s1", "a");
    expect(ledger.has("s2", "a")).toBe(false);
  });

  it("forgets a removed session entirely", () => {
    const ledger = new AcceptanceLedger();
    ledger.record("s1", "a");
    ledger.forgetSession("s1");
    expect(ledger.has("s1", "a")).toBe(false);
  });
});
