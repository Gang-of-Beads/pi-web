import { describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

/**
 * The runtime commits a prompt without the id its sender minted, and every
 * client is left to guess by text which committed copy is which - a guess a
 * captionless photo can never win. The daemon records an expectation at the
 * prompt throat and stamps the id onto the committed message before the event
 * is published.
 */
function idleService(sessionId: string) {
  const hub = new CapturingSessionEventHub();
  const fake = fakeRuntime(sessionId);
  const service = new PiSessionService(hub, {
    agentDir: TEST_AGENT_DIR,
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord(sessionId)]),
    heartbeatIntervalMs: 60_000,
  });
  return { hub, fake, service };
}

function publishedMessageEnds(hub: CapturingSessionEventHub): unknown[] {
  return hub.sessionEvents
    .filter(({ event }) => Reflect.get(event, "type") === "message.end")
    .map(({ event }): unknown => Reflect.get(event, "message"));
}

describe("the committed copy carries its sender's id", () => {
  it("stamps the runtime's committed user message before publishing it", async () => {
    const { hub, fake, service } = idleService("stamp-commit");
    await service.prompt(sessionRef("stamp-commit"), "hello there", undefined, undefined, { clientMessageId: "c-stamp" });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); });

    fake.emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "hello there" }] } });

    const [published] = publishedMessageEnds(hub);
    expect(Reflect.get(published ?? {}, "clientMessageId")).toBe("c-stamp");
    await service.dispose();
  });

  it("leaves a user message it never promised unstamped", async () => {
    const { hub, fake, service } = idleService("stamp-stranger");
    await service.prompt(sessionRef("stamp-stranger"), "hello there", undefined, undefined, { clientMessageId: "c-stamp" });

    fake.emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "an injected continuation" }] } });

    const [published] = publishedMessageEnds(hub);
    expect(Reflect.get(published ?? {}, "clientMessageId")).toBeUndefined();
    await service.dispose();
  });
});

/**
 * A message's time is when the agent got it (docs/design/message-states.md, "Time"): the daemon
 * stamps the committed copy with the moment it handed the message over, whatever pi wrote. The
 * acceptance echo keeps the send time; a waiting row shows no clock.
 */
describe("the committed copy carries the time the agent got it", () => {
  function echoedMessages(hub: CapturingSessionEventHub): unknown[] {
    return hub.sessionEvents
      .filter(({ event }) => Reflect.get(event, "type") === "message.append")
      .map(({ event }): unknown => Reflect.get(event, "message"));
  }

  it("stamps the send time on the echo and the handoff time on the committed copy, over pi's own", async () => {
    const { hub, fake, service } = idleService("sent-at");
    const sentAt = new Date(Date.now() - 15_000).toISOString();
    const before = Date.now();
    await service.prompt(sessionRef("sent-at"), "hello there", undefined, undefined, { clientMessageId: "c-sent", sentAt });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); });

    const handedBy = Date.now();
    fake.emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "hello there" }], timestamp: handedBy + 60_000 } });

    const [echo] = echoedMessages(hub);
    const [committed] = publishedMessageEnds(hub);
    const echoTime: unknown = Reflect.get(echo ?? {}, "timestamp");
    const committedTime: unknown = Reflect.get(committed ?? {}, "timestamp");
    expect({ echo: echoTime, handedInWindow: typeof committedTime === "number" && committedTime >= before && committedTime <= handedBy }).toEqual({ echo: Date.parse(sentAt), handedInWindow: true });
    await service.dispose();
  });

  it("stamps the handoff time when the sender gave none", async () => {
    const { hub, fake, service } = idleService("sent-none");
    const before = Date.now();
    await service.prompt(sessionRef("sent-none"), "hello there", undefined, undefined, { clientMessageId: "c-none" });
    await vi.waitFor(() => { expect(fake.calls.prompt).toHaveLength(1); });
    const after = Date.now();

    fake.emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "hello there" }], timestamp: after + 5_000 } });

    const stamped: unknown = Reflect.get(publishedMessageEnds(hub)[0] ?? {}, "timestamp");
    expect(typeof stamped === "number" && stamped >= before && stamped <= after).toBe(true);
    await service.dispose();
  });

  it("echoes a message without a sender id with no time, since pi's copy will carry pi's own", async () => {
    const { hub, service } = idleService("sent-anonymous");
    await service.prompt(sessionRef("sent-anonymous"), "from the pi CLI", undefined, undefined, { sentAt: new Date(Date.now() - 15_000).toISOString() });

    const [echo] = echoedMessages(hub);
    expect({ echoed: echo !== undefined, stamped: typeof echo === "object" && echo !== null && "timestamp" in echo }).toEqual({ echoed: true, stamped: false });
    await service.dispose();
  });

  it("leaves pi's time on a user message it never promised", async () => {
    const { hub, fake, service } = idleService("sent-stranger");
    await service.prompt(sessionRef("sent-stranger"), "hello there", undefined, undefined, { clientMessageId: "c-stranger", sentAt: new Date(Date.now() - 15_000).toISOString() });
    const piTime = Date.now() + 5_000;

    fake.emit({ type: "message_end", message: { role: "user", content: [{ type: "text", text: "an injected continuation" }], timestamp: piTime } });

    expect(Reflect.get(publishedMessageEnds(hub)[0] ?? {}, "timestamp")).toBe(piTime);
    await service.dispose();
  });
});

