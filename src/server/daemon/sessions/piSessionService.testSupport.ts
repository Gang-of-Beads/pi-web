import { expect } from "vitest";
import { ModelRuntime, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, type Credential, type CredentialStore } from "@earendil-works/pi-ai";
import type { GlobalSessionEvent, SessionNotificationSummaryEvent, SessionUiEvent } from "../../../shared/apiTypes.js";
import { SessionEventHub } from "../realtime/sessionEventHub.js";
import type { PiAgentSession, PiSessionListEntry, PiSessionManager, PiSessionRuntime, PiSessionServiceDependencies, ResolvedSessionFile } from "./piSessionService.js";
import { isRecord } from "../../../shared/unknownValues.js";

/** The options a direct handoff carries: the SDK's preflight callback and nothing else. */
export function directHandoffOptions(): unknown {
  const preflightResult: unknown = expect.any(Function);
  return { preflightResult };
}

/** The delivery kind a recorded prompt call was handed with, if any. */
export function handedAs(call: { options: unknown }): unknown {
  return Reflect.get(Object(call.options), "streamingBehavior");
}

export class CapturingSessionEventHub extends SessionEventHub {
  readonly sessionEvents: { sessionId: string; event: SessionUiEvent }[] = [];
  readonly globalEvents: GlobalSessionEvent[] = [];
  readonly notificationSummaryEvents: SessionNotificationSummaryEvent[] = [];
  private readonly seqBySessionOverride = new Map<string, number>();

  override publish(sessionId: string, event: SessionUiEvent): void {
    this.sessionEvents.push({ sessionId, event });
  }

  override publishGlobal(event: GlobalSessionEvent): void {
    this.globalEvents.push(event);
  }

  override publishNotificationSummary(event: SessionNotificationSummaryEvent): void {
    this.notificationSummaryEvents.push(event);
  }

  /** Test seam: set the per-session watermark returned by {@link currentSeq}. */
  setSeq(sessionId: string, value: number): void {
    this.seqBySessionOverride.set(sessionId, value);
  }

  override currentSeq(sessionId: string): number {
    return this.seqBySessionOverride.get(sessionId) ?? 0;
  }
}

export type SessionGateway = NonNullable<PiSessionServiceDependencies["sessionManager"]>;
export type RuntimeCreator = NonNullable<PiSessionServiceDependencies["createAgentRuntime"]>;

type TestExtensionBindings = Parameters<PiAgentSession["bindExtensions"]>[0];

export interface TestSession extends PiAgentSession {
  sessionName: string | undefined;
  model: PiAgentSession["model"];
  isStreaming: boolean;
  isCompacting: boolean;
  isBashRunning: boolean;
  pendingMessageCount: number;
  getSteeringMessages: () => readonly string[];
  getFollowUpMessages: () => readonly string[];
}

export function fakeSessionManager(cwd = "/workspace", patch: Partial<PiSessionManager> = {}): PiSessionManager {
  return {
    getCwd: () => cwd,
    getSessionId: () => "session-1",
    getSessionFile: () => undefined,
    getBranch: () => [],
    getLeafId: () => "leaf-1",
    ...patch,
  };
}

export function sessionRecord(id: string, cwd = "/workspace") {
  return { id, path: `/sessions/${id}.jsonl`, cwd, created: new Date("2026-01-01T00:00:00.000Z"), modified: new Date("2026-01-01T00:01:00.000Z"), messageCount: 0, firstMessage: "", allMessagesText: "" };
}

export function sessionRef(id: string, cwd = "/workspace") {
  return { id, cwd };
}

export const TEST_MODEL_PROVIDER = "anthropic";
export const TEST_MODEL_ID = "claude-sonnet-4-5-20250929";

/**
 * Seed a credential into an {@link InMemoryCredentialStore}. `modify` is the
 * only write path on the pi-ai `CredentialStore` contract, so tests that need a
 * pre-populated store go through it rather than mutating internals.
 */
export async function seedCredential(store: InMemoryCredentialStore, providerId: string, credential: Credential): Promise<void> {
  await store.modify(providerId, () => Promise.resolve(credential));
}

/**
 * Build a real {@link ModelRuntime} over an in-memory credential store — the
 * async test seam that replaces the removed `ModelRegistry.create(AuthStorage
 * .inMemory())`. Pass a pre-seeded store to exercise credential-dependent
 * behavior (e.g. auth-loss warnings).
 */
export function createTestModelRuntime(credentials: CredentialStore = new InMemoryCredentialStore()): Promise<ModelRuntime> {
  return ModelRuntime.create({ credentials, modelsPath: null, allowModelNetwork: false });
}

/**
 * Shared runtime for the common case where a test only needs model catalog
 * reads and no configured auth. Built once so the many `fakeRuntime` sessions
 * and `PiSessionService` constructions can inject it synchronously.
 */
export const testModelRuntime = await createTestModelRuntime();

const testExtensionUiContext: ExtensionUIContext = {
  select: () => Promise.resolve(undefined),
  confirm: () => Promise.resolve(false),
  input: () => Promise.resolve(undefined),
  notify() { /* no-op */ },
  onTerminalInput: () => () => undefined,
  setStatus() { /* no-op */ },
  setWorkingMessage() { /* no-op */ },
  setWorkingVisible() { /* no-op */ },
  setWorkingIndicator() { /* no-op */ },
  setHiddenThinkingLabel() { /* no-op */ },
  setWidget() { /* no-op */ },
  setFooter() { /* no-op */ },
  setHeader() { /* no-op */ },
  setTitle() { /* no-op */ },
  custom: () => Promise.reject(new Error("Custom extension UI is unavailable in tests")),
  pasteToEditor() { /* no-op */ },
  setEditorText() { /* no-op */ },
  getEditorText: () => "",
  editor: () => Promise.resolve(undefined),
  addAutocompleteProvider() { /* no-op */ },
  setEditorComponent() { /* no-op */ },
  getEditorComponent: () => undefined,
  get theme(): ExtensionUIContext["theme"] { throw new Error("Extension UI theme is unavailable in tests"); },
  getAllThemes: () => [],
  getTheme: () => undefined,
  setTheme: () => ({ success: false, error: "Extension UI is unavailable in tests" }),
  getToolsExpanded: () => false,
  setToolsExpanded() { /* no-op */ },
};

/**
 * agent-core's PendingMessageQueue: `messages` is the queue, `peek()` the next drain.
 *
 * The host reads the real queue objects, not the SDK's shown text lists, so this fake must hold
 * message objects and keep their identity when a message stays queued.
 */
function agentQueue(): { messages: unknown[]; peek: () => unknown[] } {
  return { messages: [], peek() { return [...this.messages]; } };
}

function queuedUserMessage(text: string, images: readonly unknown[] = []): Record<string, unknown> {
  const content: unknown[] = [];
  if (text !== "") content.push({ type: "text", text });
  content.push(...images);
  return { role: "user", content };
}

function isUserMessage(message: unknown): message is Record<string, unknown> {
  return isRecord(message) && message["role"] === "user";
}

/** The live array of one of agent-core's queues on a fake agent. */
export function agentQueueMessages(session: { agent: object }, kind: "steer" | "followUp"): unknown[] {
  const queue: unknown = Reflect.get(session.agent, kind === "steer" ? "steeringQueue" : "followUpQueue");
  const messages: unknown = Reflect.get(Object(queue), "messages");
  if (!Array.isArray(messages)) throw new Error(`The fake agent has no ${kind} queue`);
  return messages;
}

/** Put a user message into the runtime queue the way the SDK does, with its own object identity. */
export function queueUserMessage(session: { agent: object }, kind: "steer" | "followUp", text: string, images: readonly unknown[] = []): Record<string, unknown> {
  const message = queuedUserMessage(text, images);
  agentQueueMessages(session, kind).push(message);
  return message;
}

/** User messages the agent loop drained and has not committed yet, per fake agent, oldest first. */
const drainedByLoop = new WeakMap<object, { kind: "steer" | "followUp"; message: Record<string, unknown> }[]>();

/**
 * The agent loop's poll: it drains agent-core's queues but for the newest `keep` user messages of
 * each, and holds the drained objects until it commits them - the same objects, as in the SDK.
 * Custom messages (ask answers, subsession notices) stay queued.
 */
export function drainQueues(session: { agent: object }, keep: { steer?: number; followUp?: number } = {}): Record<string, unknown>[] {
  const drained: { kind: "steer" | "followUp"; message: Record<string, unknown> }[] = [];
  for (const kind of ["steer", "followUp"] as const) {
    const messages = agentQueueMessages(session, kind);
    const users = messages.filter(isUserMessage);
    for (const message of users.slice(0, Math.max(0, users.length - (keep[kind] ?? 0)))) {
      messages.splice(messages.indexOf(message), 1);
      drained.push({ kind, message });
    }
  }
  drainedByLoop.set(session.agent, [...(drainedByLoop.get(session.agent) ?? []), ...drained]);
  return drained.map((entry) => entry.message);
}

/** The next user message the agent commits from a lane: one the loop already drained, else the queue's head. */
export function takeQueuedMessage(session: { agent: object }, kind: "steer" | "followUp" = "steer"): Record<string, unknown> {
  const held = drainedByLoop.get(session.agent) ?? [];
  const index = held.findIndex((entry) => entry.kind === kind);
  const [drained] = index === -1 ? [] : held.splice(index, 1);
  if (drained !== undefined) return drained.message;
  const messages = agentQueueMessages(session, kind);
  const head = messages.find(isUserMessage);
  if (head === undefined) throw new Error(`Nothing queued in the ${kind} lane to commit`);
  messages.splice(messages.indexOf(head), 1);
  return head;
}

/**
 * pi's run after a direct start: the SDK reports `started` and then streams until the run ends,
 * so a message handed meanwhile joins that run instead of finding the session idle. The test ends
 * the run itself (`isStreaming = false` and `agent_end` or `agent_settled`).
 */
export function runsStayOpen(session: TestSession): void {
  const prompt = session.prompt.bind(session);
  session.prompt = (text, options) => {
    const preflightResult = options?.preflightResult;
    if (preflightResult === undefined) return prompt(text, options);
    return prompt(text, {
      ...options,
      preflightResult: (disposition) => {
        preflightResult(disposition);
        if (disposition === "started") session.isStreaming = true;
      },
    });
  };
}

function queuedText(message: unknown): string {
  const content: unknown = Reflect.get(Object(message), "content");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.flatMap((part: unknown) => Reflect.get(Object(part), "type") === "text" ? [String(Reflect.get(Object(part), "text"))] : []).join("");
}

function laneTexts(agent: object): { steering: string[]; followUp: string[] } {
  const texts = (name: string): string[] => {
    const messages: unknown = Reflect.get(agent, name);
    const queue: unknown = Reflect.get(Object(messages), "messages");
    if (!Array.isArray(queue)) return [];
    return queue.filter((message: unknown) => Reflect.get(Object(message), "role") === "user").map(queuedText);
  };
  return { steering: texts("steeringQueue"), followUp: texts("followUpQueue") };
}

export function testModel(): NonNullable<PiAgentSession["model"]> {
  const model = testModelRuntime.getModel(TEST_MODEL_PROVIDER, TEST_MODEL_ID);
  if (model === undefined) throw new Error("test model not found");
  return model;
}

export function fakeRuntime(sessionId = "session-1", patch: Partial<TestSession> = {}) {
  const tools: { name: string; parameters: unknown }[] = [];
  const promptCalls: { text: string; options: unknown }[] = [];
  const customMessageCalls: { message: { customType: string; content: string; display: boolean; details?: unknown }; options: unknown }[] = [];
  const bindExtensionCalls: TestExtensionBindings[] = [];
  const listeners: ((event: unknown) => void)[] = [];
  let extensionUiContext = testExtensionUiContext;
  const steerCalls: { text: string }[] = [];
  const calls = { abort: 0, bindExtensions: bindExtensionCalls, clearQueue: 0, dispose: 0, prompt: promptCalls, reload: 0, sendCustomMessage: customMessageCalls, steer: steerCalls };
  /**
   * Messages this fake accepted into a lane, reported with `queue_update` the way the SDK reports
   * every lane push: it shows the text and announces the change before agent-core holds the
   * object. `getSteeringMessages`/`getFollowUpMessages` are the SDK's shown texts and follow the
   * queue objects here; the host's ownership reads the objects themselves.
   */
  const agentQueues = { steeringQueue: agentQueue(), followUpQueue: agentQueue() };
  const reportQueue = (announced?: { kind: "steer" | "followUp"; text: string }): void => {
    const lanes = laneTexts(agentQueues);
    if (announced !== undefined) (announced.kind === "steer" ? lanes.steering : lanes.followUp).push(announced.text);
    for (const listener of [...listeners]) listener({ type: "queue_update", ...lanes });
  };
  const enqueue = (kind: "steer" | "followUp", text: string, images: readonly unknown[] = []): void => {
    reportQueue({ kind, text });
    (kind === "steer" ? agentQueues.steeringQueue : agentQueues.followUpQueue).messages.push(queuedUserMessage(text, images));
  };
  const session: TestSession = {
    sessionId,
    sessionFile: `/tmp/${sessionId}.jsonl`,
    messages: [],
    state: {},
    sessionName: undefined,
    model: undefined,
    thinkingLevel: "off",
    isStreaming: false,
    isCompacting: false,
    isBashRunning: false,
    pendingMessageCount: 0,
    sessionManager: fakeSessionManager("/workspace", {
      getBranch: () => session.messages.map((message) => ({ type: "message", message })),
    }),
    settingsManager: { getWarnings: () => ({}), setWarnings: () => undefined, getEnabledModels: () => undefined, setEnabledModels: () => undefined, reload: () => Promise.resolve(), flush: () => Promise.resolve(), drainErrors: () => [], },
    modelRuntime: testModelRuntime,
    scopedModels: [],
    setScopedModels: () => undefined,
    extensionRunner: {
      getRegisteredCommands: () => [],
      getMessageRenderer: () => undefined,
      getEntryRenderer: () => undefined,
      getToolDefinition: () => undefined,
      resolveToolRenderers: (_toolName: string, base: () => unknown) => base(),
      getMarkdownTransformers: () => [],
      getShortcuts: () => new Map(),
      createContext: () => ({}),
      getUIContext: () => extensionUiContext,
      setUIContext: (uiContext) => { extensionUiContext = uiContext ?? testExtensionUiContext; },
    },
    promptTemplates: [],
    resourceLoader: { getSkills: () => ({ skills: [] }) },
    subscribe: (listener: (event: unknown) => void) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
      };
    },
    bindExtensions: (bindings: TestExtensionBindings) => {
      calls.bindExtensions.push(bindings);
      if (bindings.uiContext !== undefined) extensionUiContext = bindings.uiContext;
      return Promise.resolve();
    },
    getSessionStats: () => ({ sessionId, totalMessages: 0, userMessages: 0, assistantMessages: 0, toolCalls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 }),
    getContextUsage: () => undefined,
    getAllTools: () => tools.map((tool) => ({ name: tool.name, parameters: tool.parameters })),
    getToolDefinition: (name: string) => tools.find((tool) => tool.name === name),
    reload: () => {
      calls.reload += 1;
      return Promise.resolve();
    },
    prompt: (text: string, options: unknown) => {
      calls.prompt.push({ text, options });
      const streamingBehavior: unknown = Reflect.get(Object(options), "streamingBehavior");
      const images: unknown = Reflect.get(Object(options), "images");
      const queued = session.isStreaming && (streamingBehavior === "steer" || streamingBehavior === "followUp");
      if (queued) enqueue(streamingBehavior, text, Array.isArray(images) ? images : []);
      const preflightResult: unknown = Reflect.get(Object(options), "preflightResult");
      const commandName = text.startsWith("/") ? text.slice(1).split(" ", 1)[0] : undefined;
      const disposition = commandName !== undefined && session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === commandName)
        ? "handled" : queued ? "queued" : "started";
      if (typeof preflightResult === "function") Reflect.apply(preflightResult, undefined, [disposition]);
      return Promise.resolve();
    },
    steer: (text: string, images?: unknown[]) => {
      calls.steer.push({ text });
      enqueue("steer", text, images);
      return Promise.resolve("queued" as const);
    },
    sendCustomMessage: (message: { customType: string; content: string; display: boolean; details?: unknown }, options: unknown) => {
      calls.sendCustomMessage.push({ message, options });
      return Promise.resolve();
    },
    executeBash: () => Promise.resolve({ output: "", exitCode: 0, cancelled: false, truncated: false }),
    abort: () => {
      calls.abort += 1;
      return Promise.resolve();
    },
    clearQueue: () => {
      calls.clearQueue += 1;
      const cleared = laneTexts(agentQueues);
      agentQueues.steeringQueue.messages.length = 0;
      agentQueues.followUpQueue.messages.length = 0;
      reportQueue();
      return cleared;
    },
    getSteeringMessages: () => laneTexts(agentQueues).steering,
    getFollowUpMessages: () => laneTexts(agentQueues).followUp,
    setModel: () => Promise.resolve(),
    cycleModel: () => Promise.resolve(undefined),
    getAvailableThinkingLevels: () => [],
    setThinkingLevel: () => undefined,
    cycleThinkingLevel: () => undefined,
    setSessionName: (name: string) => { session.sessionName = name; },
    compact: () => Promise.resolve({ summary: "", tokensBefore: 0 }),
    getUserMessagesForForking: () => [],
    exportToHtml: () => Promise.reject(new Error("exportToHtml should not be called in this test")),
    exportToJsonl: () => { throw new Error("exportToJsonl should not be called in this test"); },
    agent: { ...agentQueues, streamFunction: () => { throw new Error("streamFunction should not be called in this test"); } },
    ...patch,
  };
  const runtime: PiSessionRuntime = {
    cwd: session.sessionManager.getCwd(),
    session,
    setRebindSession: () => undefined,
    setBeforeSessionInvalidate: () => undefined,
    fork: () => Promise.resolve({ cancelled: false }),
    newSession: () => Promise.resolve({ cancelled: false }),
    dispose: () => {
      calls.dispose += 1;
      return Promise.resolve();
    },
  };
  return { runtime, session, calls, emit: (event: unknown) => { for (const listener of [...listeners]) listener(event); } };
}

export function runtimeCreator(runtime: PiSessionRuntime): RuntimeCreator {
  return async () => {
    await Promise.resolve();
    return runtime;
  };
}

export function sessionGateway(records: ReturnType<typeof sessionRecord>[]): SessionGateway {
  return {
    create: (cwd) => fakeSessionManager(cwd),
    list: () => Promise.resolve(records),
    listAll: () => Promise.resolve(records),
    findSession: (_cwd, sessionId) => Promise.resolve(records.find((record) => record.id === sessionId) ?? records.find((record) => record.id.startsWith(sessionId))),
    invalidateSessionFile: () => undefined,
    resolveSessionFile: resolveSessionFileFromList(() => Promise.resolve(records)),
    open: () => fakeSessionManager(),
  };
}

/**
 * Build a gateway `resolveSessionFile` on top of a `list` implementation,
 * mirroring the real resolver's precedence: an exact id wins over a prefix
 * match wherever it appears. For test gateways whose `list` fake is the source
 * of truth, this keeps id resolution consistent with what the fake lists
 * without letting the fake disagree with the production ordering rule.
 */
export function resolveSessionFileFromList(
  list: (cwd: string) => Promise<PiSessionListEntry[]>,
): (cwd: string, sessionId: string) => Promise<ResolvedSessionFile | undefined> {
  return async (cwd, sessionId) => {
    const records = await list(cwd);
    const match = records.find((record) => record.id === sessionId)
      ?? records.find((record) => record.id.startsWith(sessionId));
    return match === undefined ? undefined : { id: match.id, cwd: match.cwd, path: match.path };
  };
}

export function emptyArchiveStore(): NonNullable<PiSessionServiceDependencies["archiveStore"]> {
  return {
    list: () => Promise.resolve([]),
    get: () => Promise.resolve(undefined),
    archive: () => Promise.reject(new Error("archive should not be called")),
    restore: () => Promise.resolve(),
    isArchived: () => Promise.resolve(false),
  };
}
