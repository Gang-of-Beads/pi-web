import { describe, expect, it } from "vitest";
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

describe("activity changes are pushed, not polled", () => {
  it("publishes activity.changed when a subagent tool starts", async () => {
    const { hub, fake, service } = idleService("activity-push");
    await service.status(sessionRef("activity-push"));

    fake.emit({ type: "tool_execution_start", toolName: "subagent", toolCallId: "t1", args: {} });
    fake.emit({ type: "tool_execution_start", toolName: "bash", toolCallId: "t2", args: {} });

    const pushed = hub.sessionEvents.filter(({ event }) => Reflect.get(event, "type") === "activity.changed");
    expect(pushed).toHaveLength(1);
    await service.dispose();
  });
});

describe("the committed copy carries its sender's id", () => {
  it("stamps the runtime's committed user message before publishing it", async () => {
    const { hub, fake, service } = idleService("stamp-commit");
    await service.prompt(sessionRef("stamp-commit"), "hello there", undefined, undefined, { clientMessageId: "c-stamp" });

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
