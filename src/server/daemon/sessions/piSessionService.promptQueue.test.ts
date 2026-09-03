import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore, type AssistantMessage } from "@earendil-works/pi-ai";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiSessionService } from "./piSessionService.js";
import { CapturingSessionEventHub, createTestModelRuntime, fakeRuntime, runtimeCreator, seedCredential, sessionGateway, sessionRecord, sessionRef, TEST_MODEL_ID, TEST_MODEL_PROVIDER, testModel, testModelRuntime, type RuntimeCreator } from "./piSessionService.testSupport.js";

const TEST_AGENT_DIR = "/tmp/pi-web-test-agent";

beforeEach(() => {
  // Pi 0.82 uses PI_OFFLINE for refreshes after runtime creation. These tests
  // exercise local model/auth behavior and must never fetch provider catalogs.
  vi.stubEnv("PI_OFFLINE", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function isUserAppendEvent(event: unknown): boolean {
  if (event === null || typeof event !== "object") return false;
  if (Reflect.get(event, "type") !== "message.append") return false;
  const message: unknown = Reflect.get(event, "message");
  return message !== null && typeof message === "object" && Reflect.get(message, "role") === "user";
}

describe("PiSessionService prompt, queue, and auth warnings", () => {
  it("sends prompts to an injected runtime without touching the SDK runtime", async () => {
    const fake = fakeRuntime("prompt-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("prompt-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("prompt-session"), "Build the thing");

    expect(fake.calls.prompt).toEqual([{ text: "Build the thing", options: undefined }]);
    await service.dispose();
  });

  it("echoes the user message for direct prompts but not command-forwarded ones", async () => {
    const fake = fakeRuntime("echo-session", {
      resourceLoader: { getSkills: () => ({ skills: [{ name: "skill-creator" }] }) },
    });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("echo-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("echo-session"), "Build the thing");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);

    // The client optimistically renders command-forwarded prompts (e.g. /skill:*),
    // so the server must not publish a second copy via message.append.
    await service.runCommand(sessionRef("echo-session"), "/skill:skill-creator");
    expect(hub.sessionEvents.filter(({ event }) => event.type === "message.append")).toHaveLength(1);
    expect(fake.calls.prompt).toEqual([
      { text: "Build the thing", options: undefined },
      { text: "/skill:skill-creator", options: undefined },
    ]);

    await service.dispose();
  });

  it("rejects malformed prompt text before opening the runtime", async () => {
    const fake = fakeRuntime("prompt-session");
    let createCalls = 0;
    const createAgentRuntime: RuntimeCreator = async () => {
      createCalls += 1;
      await Promise.resolve();
      return fake.runtime;
    };
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime,
      sessionManager: sessionGateway([sessionRecord("prompt-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.prompt(sessionRef("prompt-session"), undefined)).rejects.toThrow("Prompt text is required");

    expect(createCalls).toBe(0);
    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("generates a session name for the first prompt via the session's agent.streamFunction", async () => {
    const model = testModel();
    const streamCalls: unknown[] = [];
    const streamFn: StreamFn = (streamModel, context, options) => {
      streamCalls.push({ streamModel, context, options });
      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Fix login bug" }],
        api: "anthropic-messages",
        provider: "anthropic",
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    };
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("name-session", { model, agent: { streamFunction: streamFn } });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("name-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("name-session"), "Please fix the login bug");
    await vi.waitFor(() => { expect(fake.session.sessionName).toBe("Fix login bug"); });

    expect(streamCalls).toHaveLength(1);
    expect(hub.sessionEvents.some(({ event }) => event.type === "session.name" && event.name === "Fix login bug")).toBe(true);
    await service.dispose();
  });

  it("includes queued message details in session status", async () => {
    const fake = fakeRuntime("status-session", {
      messages: [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" }],
      pendingMessageCount: 2,
      getSteeringMessages: () => ["adjust this turn"],
      getFollowUpMessages: () => ["then do this"],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("status-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.status(sessionRef("status-session"))).resolves.toMatchObject({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "steer", text: "adjust this turn" }, { kind: "followUp", text: "then do this" }],
      messageCount: 2,
    });
    await service.dispose();
  });

  it("reconciles queued messages already consumed into the transcript out of status", async () => {
    // pi drains a queued steer/follow-up when the agent emits the matching
    // user message_start, splicing by exact text. If the drained text ever
    // differs from what was queued, the entry stays in the queue forever.
    // The status must reconcile against history so a consumed message is
    // reported as delivered instead of pending forever.
    const fake = fakeRuntime("reconcile-session", {
      messages: [
        { role: "user", content: "adjust this turn" },
        { role: "assistant", content: "done" },
      ],
      pendingMessageCount: 1,
      getSteeringMessages: () => ["adjust this turn", "still pending"],
      getFollowUpMessages: () => [],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("reconcile-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.status(sessionRef("reconcile-session"))).resolves.toMatchObject({
      // "adjust this turn" already appears in the transcript -> delivered.
      pendingMessageCount: 1,
      queuedMessages: [{ kind: "steer", text: "still pending" }],
    });
    await service.dispose();
  });

  it("reconciles multi-part user content arrays against the queue", async () => {
    const fake = fakeRuntime("reconcile-parts-session", {
      messages: [
        { role: "user", content: [{ type: "text", text: "queued with image" }, { type: "image", data: "x" }] },
      ],
      pendingMessageCount: 1,
      getSteeringMessages: () => ["queued with image"],
      getFollowUpMessages: () => [],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("reconcile-parts-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.status(sessionRef("reconcile-parts-session"))).resolves.toMatchObject({
      pendingMessageCount: 0,
      queuedMessages: [],
    });
    await service.dispose();
  });

  it("does not enqueue duplicate queued message text", async () => {
    const fake = fakeRuntime("dedupe-session", {
      isStreaming: true,
      pendingMessageCount: 1,
      getFollowUpMessages: () => ["already queued"],
    });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("dedupe-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("dedupe-session"), "already queued", "followUp");

    expect(fake.calls.prompt).toEqual([]);
    await service.dispose();
  });

  it("echoes queued prompts so the message never looks lost", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("queued-session", { isStreaming: true });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("queued-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("queued-session"), "Wait for the current turn", "followUp");

    expect(fake.calls.prompt).toEqual([{ text: "Wait for the current turn", options: { streamingBehavior: "followUp" } }]);
    // The queue is server-side; the client still sees its own message
    // immediately (mobile otherwise reads as "message disappeared").
    expect(hub.sessionEvents.some(({ event }) => isUserAppendEvent(event))).toBe(true);
    await service.dispose();
  });

  it("holds prompts sent during compaction until compaction finishes", async () => {
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("compacting-session", { isCompacting: true });
    let resolveFirstPrompt: (() => void) | undefined;
    fake.session.prompt = (text: string, options?: { streamingBehavior?: "steer" | "followUp" }) => {
      fake.calls.prompt.push({ text, options });
      if (options === undefined) {
        fake.session.isStreaming = true;
        return new Promise<void>((resolve) => { resolveFirstPrompt = resolve; });
      }
      return Promise.resolve();
    };
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("compacting-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("compacting-session"), "Start task 1", "followUp");
    await service.prompt(sessionRef("compacting-session"), "Then task 2", "followUp");

    expect(fake.calls.prompt).toEqual([]);
    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append")).toBe(false);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 2,
      queuedMessages: [{ kind: "followUp", text: "Start task 1" }, { kind: "followUp", text: "Then task 2" }],
    });

    fake.session.isCompacting = false;
    fake.emit({ type: "compaction_end" });
    // compaction_end drains the held queue on a scheduled timer; wait for the
    // first prompt to be delivered rather than sleeping a fixed interval.
    await vi.waitFor(() => {
      expect(fake.calls.prompt).toEqual([{ text: "Start task 1", options: undefined }]);
    });

    expect(hub.sessionEvents.some(({ event }) => event.type === "message.append" && JSON.stringify(event.message).includes("Start task 1"))).toBe(true);
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 1,
      queuedMessages: [{ kind: "followUp", text: "Then task 2" }],
    });

    fake.emit({ type: "agent_start" });
    // agent_start drains the next queued prompt asynchronously; wait for both
    // prompts to have been delivered rather than sleeping.
    await vi.waitFor(() => {
      expect(fake.calls.prompt).toEqual([
        { text: "Start task 1", options: undefined },
        { text: "Then task 2", options: { streamingBehavior: "followUp" } },
      ]);
    });
    await expect(service.status(sessionRef("compacting-session"))).resolves.toMatchObject({
      pendingMessageCount: 0,
      queuedMessages: [],
    });
    resolveFirstPrompt?.();
    await service.dispose();
  });

  it("clears runtime and compaction queues without interrupting active work", async () => {
    const steeringMessages = ["adjust this turn"];
    const followUpMessages = ["then do this"];
    const transcript = [{ role: "user", content: "keep this history" }];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("clear-queue-session", {
      messages: transcript,
      isStreaming: true,
      isCompacting: true,
      pendingMessageCount: 2,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => followUpMessages,
    });
    const clearRuntimeQueue = vi.fn(() => {
      const cleared = { steering: [...steeringMessages], followUp: [...followUpMessages] };
      steeringMessages.length = 0;
      followUpMessages.length = 0;
      fake.session.pendingMessageCount = 0;
      return cleared;
    });
    fake.session.clearQueue = clearRuntimeQueue;
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("clear-queue-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("clear-queue-session"), "queued during compaction", "followUp");
    await expect(service.status(sessionRef("clear-queue-session"))).resolves.toMatchObject({
      isStreaming: true,
      isCompacting: true,
      pendingMessageCount: 3,
      queuedMessages: [
        { kind: "steer", text: "adjust this turn" },
        { kind: "followUp", text: "then do this" },
        { kind: "followUp", text: "queued during compaction" },
      ],
    });

    const status = await service.clearQueue(sessionRef("clear-queue-session"));

    expect(clearRuntimeQueue).toHaveBeenCalledOnce();
    expect(status).toMatchObject({
      isStreaming: true,
      isCompacting: true,
      pendingMessageCount: 0,
      queuedMessages: [],
      messageCount: 1,
    });
    expect(fake.session.messages).toBe(transcript);
    expect(fake.calls.prompt).toEqual([]);
    expect(fake.calls.abort).toBe(0);
    expect(fake.calls.dispose).toBe(0);
    const publishedStatuses = hub.sessionEvents.filter(({ event }) => event.type === "status.update");
    expect(publishedStatuses.at(-1)?.event).toEqual({ type: "status.update", status });
    await service.dispose();
  });

  it("recalls one queued message and replays the rest in order", async () => {
    // The runtime can only empty the whole queue, so removing one entry means
    // emptying it and putting the survivors back. What this test pins down is
    // that the survivors come back *in their original order* and that the
    // replay does not go through the duplicate-suppression in prompt(), which
    // would see each replayed text as a double-send and drop it.
    const steeringMessages = ["first steer", "second steer"];
    const followUpMessages = ["a follow up"];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("recall-session", {
      isStreaming: true,
      pendingMessageCount: 3,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => followUpMessages,
    });
    fake.session.clearQueue = vi.fn(() => {
      const cleared = { steering: [...steeringMessages], followUp: [...followUpMessages] };
      steeringMessages.length = 0;
      followUpMessages.length = 0;
      return cleared;
    });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("recall-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.recallQueuedMessage(sessionRef("recall-session"), { kind: "steer", text: "first steer" });

    expect(fake.calls.prompt).toEqual([
      { text: "second steer", options: { streamingBehavior: "steer" } },
      { text: "a follow up", options: { streamingBehavior: "followUp" } },
    ]);
    await service.dispose();
  });

  /**
   * The replay decides queueing at the moment of replay, not when the message
   * was queued: a follow-up parked long ago and replayed to an idle runtime is
   * sent outright, because an idle runtime has no turn-end to drain a parked
   * follow-up. Only a service-level assertion has teeth here - the predicate's
   * own tests stayed green while the wiring was missing, and the busy-replay
   * test above passes with the wiring deleted.
   */
  it("replays a parked follow-up as a direct send when the runtime has gone idle", async () => {
    const steeringMessages = ["an old steer"];
    const followUpMessages = ["an old follow up"];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("recall-idle-session", {
      isStreaming: false,
      pendingMessageCount: 2,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => followUpMessages,
    });
    fake.session.clearQueue = vi.fn(() => {
      const cleared = { steering: [...steeringMessages], followUp: [...followUpMessages] };
      steeringMessages.length = 0;
      followUpMessages.length = 0;
      return cleared;
    });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("recall-idle-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.recallQueuedMessage(sessionRef("recall-idle-session"), { kind: "steer", text: "an old steer" });

    expect(fake.calls.prompt).toEqual([
      { text: "an old follow up", options: undefined },
    ]);
    await service.dispose();
  });

  it("leaves the queue untouched when the recalled message is already gone", async () => {
    // The agent can take a message between the click and the request. Replaying
    // everything unchanged is the honest outcome: nothing is lost, and the
    // returned status lets the client re-render whatever is actually queued.
    const steeringMessages = ["still queued"];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("recall-miss-session", {
      isStreaming: true,
      pendingMessageCount: 1,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => [],
    });
    fake.session.clearQueue = vi.fn(() => {
      const cleared: { steering: string[]; followUp: string[] } = { steering: [...steeringMessages], followUp: [] };
      steeringMessages.length = 0;
      return cleared;
    });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("recall-miss-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.recallQueuedMessage(sessionRef("recall-miss-session"), { text: "already taken" });

    expect(fake.calls.prompt).toEqual([{ text: "still queued", options: { streamingBehavior: "steer" } }]);
    await service.dispose();
  });

  it("reports whether the message was actually taken back", async () => {
    // The agent can read the message between the click and the request. Saying
    // "recalled" anyway is how a client ends up deleting a bubble the
    // conversation already contains and offering the text for a second send.
    const steeringMessages = ["still here"];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("recall-report-session", {
      isStreaming: true,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => [],
    });
    fake.session.clearQueue = vi.fn(() => {
      const cleared: { steering: string[]; followUp: string[] } = { steering: [...steeringMessages], followUp: [] };
      steeringMessages.length = 0;
      return cleared;
    });
    // A replayed prompt lands back in the queue, as it does in the runtime;
    // without that the first recall would leave the queue permanently empty and
    // the second assertion would pass for the wrong reason.
    const originalPrompt = fake.session.prompt.bind(fake.session);
    type PromptOptions = Parameters<typeof originalPrompt>[1];
    fake.session.prompt = vi.fn(async (text: string, options?: PromptOptions) => {
      if (options?.streamingBehavior === "steer") steeringMessages.push(text);
      return originalPrompt(text, options);
    });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("recall-report-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await expect(service.recallQueuedMessage(sessionRef("recall-report-session"), { text: "already read" }))
      .resolves.toMatchObject({ recalled: false });
    await expect(service.recallQueuedMessage(sessionRef("recall-report-session"), { text: "still here" }))
      .resolves.toMatchObject({ recalled: true });
    await service.dispose();
  });

  it("replays surviving messages with the images they were sent with", async () => {
    // The runtime's queue is text-only, so a replay that rebuilds it from
    // strings silently strips attachments off messages nobody recalled - the
    // bubble still says "queued" and the image is simply missing when the agent
    // reads it.
    // The queue starts with only the message that will be recalled; the one
    // carrying the image is added through the real prompt path, so this covers
    // the same route a browser takes.
    const steeringMessages = ["and this"];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("recall-images-session", {
      isStreaming: true,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => [],
    });
    fake.session.clearQueue = vi.fn(() => {
      const cleared: { steering: string[]; followUp: string[] } = { steering: [...steeringMessages], followUp: [] };
      steeringMessages.length = 0;
      return cleared;
    });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("recall-images-session")]),
      heartbeatIntervalMs: 60_000,
    });
    const originalPrompt = fake.session.prompt.bind(fake.session);
    type PromptOptions = Parameters<typeof originalPrompt>[1];
    fake.session.prompt = vi.fn(async (text: string, options?: PromptOptions) => {
      if (options?.streamingBehavior === "steer") steeringMessages.push(text);
      return originalPrompt(text, options);
    });
    // A real 1x1 PNG: the attachment pipeline decodes and re-encodes, and
    // silently drops anything it cannot read as an image.
    const attachment = { kind: "image" as const, data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", mimeType: "image/png" };
    await service.prompt(sessionRef("recall-images-session"), "look at this", "steer", [attachment]);
    fake.calls.prompt.length = 0;

    await service.recallQueuedMessage(sessionRef("recall-images-session"), { text: "and this" });

    // The replayed prompt carries the image the original was sent with; the
    // fake records options as unknown, so the shape is asserted rather than
    // reached into.
    expect(fake.calls.prompt).toHaveLength(1);
    expect(fake.calls.prompt[0]).toMatchObject({
      text: "look at this",
      options: { streamingBehavior: "steer", images: [{ type: "image", mimeType: "image/png" }] },
    });
    await service.dispose();
  });

  it("hands back the queue it emptied when work is aborted", async () => {
    // Stop cancels the turn those messages were written for, so the queue does
    // have to go - but deleting the text outright is data loss wearing a
    // feature's clothes. The caller puts what comes back into the composer.
    const steeringMessages = ["adjust this"];
    const followUpMessages = ["and then this"];
    const hub = new CapturingSessionEventHub();
    const fake = fakeRuntime("abort-session", {
      isStreaming: true,
      pendingMessageCount: 2,
      getSteeringMessages: () => steeringMessages,
      getFollowUpMessages: () => followUpMessages,
    });
    fake.session.clearQueue = vi.fn(() => {
      const cleared = { steering: [...steeringMessages], followUp: [...followUpMessages] };
      steeringMessages.length = 0;
      followUpMessages.length = 0;
      return cleared;
    });
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-session")]),
      heartbeatIntervalMs: 60_000,
    });
    await service.status(sessionRef("abort-session"));

    const { discarded } = await service.abort(sessionRef("abort-session"));

    expect(discarded).toEqual([
      { kind: "steer", text: "adjust this" },
      { kind: "followUp", text: "and then this" },
    ]);
    await service.dispose();
  });

  it("does not publish full status for streaming text deltas", async () => {
    // Streaming text deltas carry no status change; publishing the full
    // status for every token would re-serialize + broadcast session state on
    // the agent's own event loop and slow streaming relative to the TUI.
    const fake = fakeRuntime("delta-session", { messages: [], isStreaming: true });
    const hub = new CapturingSessionEventHub();
    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("delta-session")]),
      heartbeatIntervalMs: 60_000,
    });
    await service.prompt(sessionRef("delta-session"), "Start streaming");

    const before = hub.sessionEvents.filter(({ event }) => event.type === "status.update").length;
    fake.emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "hell" } });
    fake.emit({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "reason" } });
    const after = hub.sessionEvents.filter(({ event }) => event.type === "status.update").length;
    expect(after - before).toBe(0);

    // Structural events still publish status.
    fake.emit({ type: "message_start", message: { role: "assistant", content: [] } });
    const afterStart = hub.sessionEvents.filter(({ event }) => event.type === "status.update").length;
    expect(afterStart - before).toBeGreaterThan(0);
    await service.dispose();
  });

  it("clears an already-empty queue idempotently", async () => {
    const fake = fakeRuntime("clear-empty-queue-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("clear-empty-queue-session")]),
      heartbeatIntervalMs: 60_000,
    });

    const firstStatus = await service.clearQueue(sessionRef("clear-empty-queue-session"));
    const secondStatus = await service.clearQueue(sessionRef("clear-empty-queue-session"));

    expect(fake.calls.clearQueue).toBe(2);
    expect(fake.calls.abort).toBe(0);
    expect(firstStatus).toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    expect(secondStatus).toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    await service.dispose();
  });

  it("clears queued messages when aborting active work", async () => {
    const fake = fakeRuntime("abort-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("abort-session"));
    await service.abort(sessionRef("abort-session"));

    expect(fake.calls.clearQueue).toBe(1);
    expect(fake.calls.abort).toBe(1);
    await service.dispose();
  });

  it("clears prompts queued during compaction when aborting active work", async () => {
    const fake = fakeRuntime("abort-compaction-session", { isCompacting: true });
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("abort-compaction-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.prompt(sessionRef("abort-compaction-session"), "Do not deliver after abort", "followUp");
    await expect(service.status(sessionRef("abort-compaction-session"))).resolves.toMatchObject({ pendingMessageCount: 1 });
    await service.abort(sessionRef("abort-compaction-session"));

    expect(fake.calls.clearQueue).toBe(1);
    expect(fake.calls.prompt).toEqual([]);
    await expect(service.status(sessionRef("abort-compaction-session"))).resolves.toMatchObject({ pendingMessageCount: 0, queuedMessages: [] });
    await service.dispose();
  });

  it("reloads models.json before listing and selecting models", async () => {
    const agentDir = await mkdtemp(join(tmpdir(), "pi-web-model-runtime-"));
    try {
      const modelsPath = join(agentDir, "models.json");
      await writeLocalModelsConfig(modelsPath, "initial-model");
      const modelRuntime = await ModelRuntime.create({
        credentials: new InMemoryCredentialStore(),
        modelsPath,
        allowModelNetwork: false,
      });
      const setSessionModel = vi.fn(() => Promise.resolve());
      const fake = fakeRuntime("models-session", { modelRuntime, setModel: setSessionModel });
      const service = new PiSessionService(new CapturingSessionEventHub(), {
        agentDir,
        modelRuntime,
        createAgentRuntime: runtimeCreator(fake.runtime),
        sessionManager: sessionGateway([sessionRecord("models-session")]),
        heartbeatIntervalMs: 60_000,
      });

      try {
        await writeLocalModelsConfig(modelsPath, "listed-model");
        const listed = await service.availableModels(sessionRef("models-session"));
        expect(listed).toEqual(expect.arrayContaining([
          expect.objectContaining({ provider: "test-local", id: "listed-model" }),
        ]));
        expect(listed).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ provider: "test-local", id: "initial-model" }),
        ]));

        await writeLocalModelsConfig(modelsPath, "selected-model");
        await expect(service.setModel(sessionRef("models-session"), "test-local", "selected-model")).resolves.toBeDefined();
        expect(setSessionModel).toHaveBeenCalledWith(expect.objectContaining({
          provider: "test-local",
          id: "selected-model",
        }));
      } finally {
        await service.dispose();
      }
    } finally {
      await rm(agentDir, { recursive: true, force: true });
    }
  });

  it("refreshes auth state and dedupes warnings when logout removes the current model's credentials", async () => {
    const hub = new CapturingSessionEventHub();
    // The shared model runtime reads a live credential store. Mutating the store
    // and refreshing here simulates the committed snapshot that
    // ModelRuntime.login()/logout() establishes before AuthService emits.
    // applyAuthChange then only needs to notify active sessions.
    const credentials = new InMemoryCredentialStore();
    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-test" });
    const modelRuntime = await createTestModelRuntime(credentials);
    const model = modelRuntime.getModel(TEST_MODEL_PROVIDER, TEST_MODEL_ID);
    if (model === undefined) throw new Error("Expected Anthropic model fixture");
    const fake = fakeRuntime("auth-session", { model, modelRuntime });

    const service = new PiSessionService(hub, {
      agentDir: TEST_AGENT_DIR,
      modelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("auth-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("auth-session"));
    hub.sessionEvents.length = 0;
    hub.globalEvents.length = 0;

    await credentials.delete("anthropic");
    await modelRuntime.refresh();
    service.applyAuthChange({ removedProviderId: "anthropic" });
    service.applyAuthChange({ removedProviderId: "anthropic" });

    const warningCount = () => hub.sessionEvents.filter(({ event }) => event.type === "command.output" && event.level === "error" && event.message.includes(`${TEST_MODEL_PROVIDER}/${TEST_MODEL_ID}`)).length;
    expect(warningCount()).toBe(1);
    expect(hub.globalEvents.some((event) => event.type === "status.update" && event.status.sessionId === "auth-session")).toBe(true);

    await seedCredential(credentials, "anthropic", { type: "api_key", key: "sk-new" });
    await modelRuntime.refresh();
    service.applyAuthChange();
    await credentials.delete("anthropic");
    await modelRuntime.refresh();
    service.applyAuthChange({ removedProviderId: "anthropic" });
    expect(warningCount()).toBe(2);

    await service.dispose();
  });

  it("clears queued messages when stopping a session runtime", async () => {
    const fake = fakeRuntime("stop-session");
    const service = new PiSessionService(new CapturingSessionEventHub(), {
      agentDir: TEST_AGENT_DIR,
      modelRuntime: testModelRuntime,
      createAgentRuntime: runtimeCreator(fake.runtime),
      sessionManager: sessionGateway([sessionRecord("stop-session")]),
      heartbeatIntervalMs: 60_000,
    });

    await service.status(sessionRef("stop-session"));
    await service.stop(sessionRef("stop-session"));

    expect(fake.calls.clearQueue).toBe(1);
    await service.dispose();
  });
});

async function writeLocalModelsConfig(path: string, modelId: string): Promise<void> {
  await writeFile(path, JSON.stringify({
    providers: {
      "test-local": {
        name: "Test Local",
        baseUrl: "http://127.0.0.1:1234/v1",
        apiKey: "offline-test-key",
        api: "openai-completions",
        models: [{
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1_000,
          maxTokens: 100,
        }],
      },
    },
  }));
}
