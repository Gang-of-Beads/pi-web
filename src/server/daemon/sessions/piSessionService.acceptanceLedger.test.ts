import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";
import { createInMemoryAcceptanceLedger } from "./acceptanceLedger.js";

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

    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(2); });
  });

  it("leaves id-less prompts alone", async () => {
    const { fake, service } = idleService("ledger-anonymous");

    await service.prompt(sessionRef("ledger-anonymous"), "hello");
    await service.prompt(sessionRef("ledger-anonymous"), "hello");

    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(2); });
  });
});

describe("a submission the runtime refused gives its acceptance back", () => {
  /**
   * The acceptance is recorded before the fire-and-forget handoff. If the
   * runtime then refuses, the record must go: answering the retry "accepted"
   * for a prompt that never ran converts a duplicate risk into a silent loss,
   * which is strictly worse. Proven with an interleaving by the review.
   */
  it("lets a retry re-attempt after the first submission failed", async () => {
    const { fake, service } = idleService("ledger-refused");
    let attempts = 0;
    fake.session.prompt = (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => {
      attempts += 1;
      fake.calls.prompt.push({ text, options });
      return attempts === 1 ? Promise.reject(new Error("runtime said no")) : Promise.resolve();
    };

    await service.prompt(sessionRef("ledger-refused"), "hello", undefined, undefined, { clientMessageId: "c-1" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await service.prompt(sessionRef("ledger-refused"), "hello", undefined, undefined, { clientMessageId: "c-1" });

    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(2); });
  });
});


describe("the ledger itself", () => {
  it("keeps sessions apart", () => {
    const ledger = createInMemoryAcceptanceLedger();
    ledger.record("s1", "a");
    expect(ledger.has("s2", "a")).toBe(false);
  });

  it("moves a row forward only, and never forgets one", () => {
    const ledger = createInMemoryAcceptanceLedger();
    ledger.record("s", "a");
    ledger.settle("s", "a", "succeeded");
    ledger.settle("s", "a", "failed");
    expect(ledger.outcomesFor("s", ["a"])).toEqual({ a: "succeeded" });
    expect(ledger.has("s", "a")).toBe(true);
  });

  it("answers a withdrawn identity as a duplicate, so a retry cannot resurrect it", () => {
    const ledger = createInMemoryAcceptanceLedger();
    ledger.record("s", "w");
    ledger.settle("s", "w", "withdrawn");
    ledger.record("s", "w");
    expect({ has: ledger.has("s", "w"), outcome: ledger.outcomesFor("s", ["w"]) }).toEqual({ has: true, outcome: { w: "withdrawn" } });
  });

  it("admits a refused identity again, so the sender's retry can run it", () => {
    const ledger = createInMemoryAcceptanceLedger();
    ledger.record("s", "r");
    ledger.settle("s", "r", "failed");
    expect(ledger.has("s", "r")).toBe(false);
    ledger.record("s", "r");
    expect(ledger.outcomesFor("s", ["r"])).toEqual({ r: "pending" });
  });
});
