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

    expect(appended.map((entry) => entry.customType)).toEqual(["pi-web.turn.stopped"]);
    expect(Reflect.get(Object(appended[0]?.data), "by")).toBe("you");
    expect(String(Reflect.get(Object(appended[0]?.data), "at"))).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
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

  /**
   * B30: a Stop pressed while pi waits to retry ends the turn with no reply at all. The row the
   * reader sees is the Stop itself, published before the turn's end, as history will show it.
   */
  it("settles a Stop no reply followed as the turn's row, before the turn ends", async () => {
    const { fake, appended, events, service } = await streamingSession();
    fake.session.isStreaming = true;
    await service.abort(sessionRef("stop-session"));
    fake.emit({ type: "agent_end" });

    const types = events.sessionEvents.map(({ event }) => event.type);
    const settled = events.sessionEvents.map(({ event }) => event).find((event) => event.type === "message.end");
    const at: unknown = Reflect.get(Object(appended[0]?.data), "at");
    expect(settled?.type === "message.end" ? settled.message : undefined).toEqual({ role: "assistant", content: [], stopReason: "aborted", stoppedBy: "you", timestamp: at });
    expect(types.indexOf("message.end")).toBeLessThan(types.indexOf("agent.end"));
    await service.dispose();
  });

  /**
   * pi schedules its retry from the end of the failed run, so the wait comes after `agent_end`,
   * and the Stop that cancels it is followed only by `auto_retry_end`. Measured on 8505: the Stop
   * entry was the branch's last entry, and no row reached the page live.
   */
  it("settles a Stop that cancelled pi's retry wait when the retry ends", async () => {
    const { fake, events, service } = await streamingSession();
    fake.session.isStreaming = true;
    fake.emit({ type: "agent_end" });
    await service.abort(sessionRef("stop-session"));
    fake.emit({ type: "auto_retry_end", success: false, attempt: 1, finalError: "Retry cancelled" });

    const marks: unknown[] = [];
    for (const { event } of events.sessionEvents) if (event.type === "message.end") marks.push(Reflect.get(Object(event.message), "stoppedBy"));
    expect(marks).toEqual(["you"]);
    await service.dispose();
  });

  it("publishes no row of its own when the Stop cut a reply", async () => {
    const { fake, events, service } = await streamingSession();
    fake.session.isStreaming = true;
    await service.abort(sessionRef("stop-session"));
    fake.emit({ type: "message_end", message: cutReply() });
    fake.emit({ type: "agent_end" });

    expect(events.sessionEvents.filter(({ event }) => event.type === "message.end")).toHaveLength(1);
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
