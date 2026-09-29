import { describe, expect, it } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, fakeRuntime, fakeSessionManager, runtimeCreator, sessionGateway, sessionRecord, sessionRef, testModelRuntime } from "./piSessionService.testSupport.js";

/**
 * Owner, 2026-09-30: a cut-off turn says one of two things - you stopped it, or it
 * was interrupted. Only the daemon knows a Stop was pressed, so it records the Stop
 * durably (history reads it after a reload) and marks the live reply the Stop cut.
 */
async function streamingSession() {
  const fake = fakeRuntime("stop-session");
  const appended: { customType: string; data: unknown }[] = [];
  fake.session.sessionManager = fakeSessionManager("/workspace", {
    appendCustomEntry: (customType: string, data?: unknown) => { appended.push({ customType, data }); return "entry-1"; },
  });
  const events = new CapturingSessionEventHub();
  const service = new PiSessionService(events, {
    agentDir: "/tmp/pi-web-test-agent",
    modelRuntime: testModelRuntime,
    createAgentRuntime: runtimeCreator(fake.runtime),
    sessionManager: sessionGateway([sessionRecord("stop-session")]),
    heartbeatIntervalMs: 60_000,
  });
  await service.status(sessionRef("stop-session"));
  return { fake, appended, events, service };
}

const cutReply = () => ({ role: "assistant", content: [], stopReason: "error", errorMessage: "This operation was aborted" });

describe("a Stop the reader pressed", () => {
  it("is recorded durably and marks the reply it cut", async () => {
    const { fake, appended, events, service } = await streamingSession();
    fake.session.isStreaming = true;
    await service.abort(sessionRef("stop-session"));
    const reply = cutReply();
    fake.emit({ type: "message_end", message: reply });

    expect(appended).toEqual([{ customType: "pi-web.turn.stopped", data: { by: "you" } }]);
    expect(Reflect.get(reply, "stoppedBy")).toBe("you");
    const published = events.sessionEvents.map(({ event }) => event).find((event) => event.type === "message.end");
    const publishedMessage: unknown = published?.type === "message.end" ? published.message : undefined;
    expect(typeof publishedMessage === "object" && publishedMessage !== null ? Reflect.get(publishedMessage, "stoppedBy") : undefined).toBe("you");
    await service.dispose();
  });

  it("marks nothing when no turn was running", async () => {
    const { fake, appended, service } = await streamingSession();
    await service.abort(sessionRef("stop-session"));
    const reply = cutReply();
    fake.emit({ type: "message_end", message: reply });

    expect(appended).toEqual([]);
    expect(Reflect.get(reply, "stoppedBy")).toBeUndefined();
    await service.dispose();
  });

  it("does not reach past the end of the turn it stopped", async () => {
    const { fake, service } = await streamingSession();
    fake.session.isStreaming = true;
    await service.abort(sessionRef("stop-session"));
    fake.emit({ type: "agent_end" });
    const later = cutReply();
    fake.emit({ type: "message_end", message: later });

    expect(Reflect.get(later, "stoppedBy")).toBeUndefined();
    await service.dispose();
  });
});
