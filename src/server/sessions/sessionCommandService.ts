import crypto from "node:crypto";
import type { SessionUiEvent } from "../../shared/apiTypes.js";
import type { ClientCommandResult, ClientSession, ClientSessionTreeSnapshot } from "../types.js";
import { isBuiltinCommand } from "./builtinCommands.js";

export interface CommandSession {
  sessionId: string;
  sessionFile: string | undefined;
  sessionName: string | undefined;
  messages: readonly unknown[];
  isStreaming: boolean;
  isBashRunning: boolean;
  isCompacting: boolean;
  pendingMessageCount: number;
  promptTemplates: readonly { name: string }[];
  extensionRunner: { getRegisteredCommands(): readonly { invocationName: string }[] };
  resourceLoader: { getSkills(): { skills: readonly { name: string }[] } };
  sessionManager: { getLeafId(): string | null; getHeader?: () => { parentSession?: string } | null | undefined };
  setSessionName: (name: string) => void;
  compact: (instructions?: string) => Promise<{ summary: string; tokensBefore: number }>;
  getSessionStats: () => {
    sessionId: string;
    totalMessages: number;
    userMessages: number;
    assistantMessages: number;
    toolCalls: number;
    tokens: { input: number; output: number; total: number };
    cost: number;
  };
  getUserMessagesForForking: () => readonly { entryId: string; text: string }[];
}

export interface CommandRuntime<TSession extends CommandSession = CommandSession> {
  cwd: string;
  session: TSession;
  fork: (entryId: string, options?: { position?: "before" | "at" }) => Promise<{ cancelled: boolean; selectedText?: string }>;
}

export interface CommandActiveSession<TSession extends CommandSession = CommandSession> {
  runtime: CommandRuntime<TSession>;
}

export type GetCommandActiveSession<TSession extends CommandSession = CommandSession> = (sessionId: string) => Promise<CommandActiveSession<TSession>>;

export interface CommandEventPublisher {
  publish(sessionId: string, event: SessionUiEvent): void;
  publishGlobal?(event: Extract<SessionUiEvent, { type: "session.name" }>): void;
}

/** Reported both by an immediate /reload and by one that ran off the queue. */
const RELOAD_DONE_MESSAGE = "Session runtime resources reloaded. Extensions, skills, prompt templates, themes, and context/system prompt files are refreshed for this session. Reload the browser page separately for PI WEB browser plugin changes.";

export interface SessionCommandLifecycle<TSession extends CommandSession = CommandSession> {
  onCompactionStart?: (session: TSession) => void;
  onCompactionEnd?: (session: TSession, result: "success" | "error", detail?: string) => void;
  reloadSession?: (session: TSession) => Promise<void>;
  getSessionTree?: (session: TSession) => ClientSessionTreeSnapshot | undefined;
  hasActiveWork?: (session: TSession) => boolean;
  isTreeNavigationActive?: (session: TSession) => boolean;
  runSessionReplacement?: <T>(session: TSession, operation: () => Promise<T>) => Promise<T>;
  /** A forwarded command's turn ended with nothing a reader could see. */
  onSilentCommand?: (sessionId: string, command: string) => void;
}

export interface SessionCommandNaming {
  listSessionNames?: (cwd: string) => Promise<readonly string[]>;
}

export interface ForkEntryOptions {
  /** Rechecked inside the serialized replacement boundary when supplied by /tree. */
  expectedLeafId: string | null;
}

type RelatedSessionKind = "fork" | "copy";

interface PendingCommandSelect {
  sessionId: string;
  command: "fork";
}

export class SessionCommandService<TSession extends CommandSession = CommandSession> {
  private readonly pendingSelects = new Map<string, PendingCommandSelect>();
  /**
   * Sessions with a /reload waiting for the session to go quiet.
   *
   * Reload replaces the session's runtime resources, so it genuinely cannot run
   * mid-turn - but "come back and type it again later" put the cost of that on
   * the person, who then had to watch the session and remember. Holding the
   * intent is the same answer the queue gives a message sent while busy.
   */
  private readonly pendingReloads = new Set<string>();
  /** Forwarded commands whose turns have shown the reader nothing yet. */
  private readonly silentCommandWatches = new Map<string, string>();

  constructor(
    private readonly getActive: GetCommandActiveSession<TSession>,
    private readonly prompt: (sessionId: string, text: string) => Promise<void>,
    private readonly events: CommandEventPublisher,
    private readonly lifecycle: SessionCommandLifecycle<TSession> = {},
    private readonly naming: SessionCommandNaming = {},
  ) {}

  async run(sessionId: string, text: string): Promise<ClientCommandResult> {
    const active = await this.getActive(sessionId);
    const session = active.runtime.session;
    const [name = "", ...args] = text.trim().replace(/^\//, "").split(/\s+/);
    const rest = args.join(" ").trim();

    if (this.lifecycle.isTreeNavigationActive?.(session) === true) return treeNavigationActiveUnsupported();

    if (!isBuiltinCommand(name)) {
      if (this.isRuntimeCommand(session, name)) {
        // The command is forwarded to the agent, which expands it (e.g. /skill:*
        // into a skill block) and streams the canonical message back. That is the
        // authoritative feedback, so we don't synthesize an extra "Accepted" line
        // that would only vanish on reload. What we do watch for is the turn
        // ending without anything visible at all - a command that silently
        // vanished reads as a command that never ran.
        this.silentCommandWatches.set(session.sessionId, `/${name}`);
        await this.prompt(sessionId, text);
        return { type: "done" };
      }
      return { type: "unsupported", message: `Unknown command: /${name}` };
    }

    if (name === "session") return { type: "done", message: formatSessionStats(session) };
    if (name === "name") return this.nameSession(active, rest);
    if (name === "compact") return this.compact(session, rest);
    if (name === "reload") return this.reload(session);
    if (name === "clone") return this.clone(active);
    if (name === "fork") return this.fork(active);
    if (name === "tree") return this.tree(session);

    return { type: "unsupported", message: `/${name} is not implemented in the web UI yet` };
  }

  async respond(sessionId: string, requestId: string, value: string): Promise<ClientCommandResult> {
    const pending = this.pendingSelects.get(requestId);
    if (pending?.sessionId !== sessionId) return { type: "unsupported", message: "Command request expired" };
    this.pendingSelects.delete(requestId);
    return this.forkEntry(sessionId, value);
  }

  /**
   * Forks the session from a specific tree entry into a new session file, leaving
   * the original session untouched. Shared by the `/fork` select response and the
   * session-tree fork-from-entry path. User entries fork from "before" so their
   * text returns as a prompt draft; every other entry forks "at" so the forked
   * file includes it.
   */
  async forkEntry(sessionId: string, entryId: string, options?: ForkEntryOptions): Promise<ClientCommandResult> {
    const active = await this.getActive(sessionId);
    if (this.lifecycle.isTreeNavigationActive?.(active.runtime.session) === true) return treeNavigationActiveUnsupported();
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("fork");
    const relatedName = await this.nextRelatedSessionName(active, "fork");
    if (this.lifecycle.isTreeNavigationActive?.(active.runtime.session) === true) return treeNavigationActiveUnsupported();
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("fork");
    const result = await this.runSessionReplacement(active.runtime, async () => {
      const session = active.runtime.session;
      if (options !== undefined && session.sessionManager.getLeafId() !== options.expectedLeafId) {
        throw new Error("The session changed since /tree was opened. Reopen /tree and try again.");
      }
      // Resolve the entry kind from the session state protected by the same
      // replacement boundary as the fork, not Pi's text-only /fork selector.
      const position = this.forkPosition(session, entryId);
      const forkResult = await active.runtime.fork(entryId, { position });
      if (!forkResult.cancelled) this.tryNameRelatedSession(active.runtime.session, relatedName);
      return forkResult;
    });
    if (result.cancelled) return { type: "done", message: "Fork cancelled" };
    return { type: "done", message: "Session forked", session: clientSessionFromRuntime(active.runtime), ...promptDraft(result.selectedText) };
  }

  private nameSession(active: CommandActiveSession<TSession>, name: string): ClientCommandResult {
    if (name === "") return { type: "unsupported", message: "Usage: /name <session name>" };
    active.runtime.session.setSessionName(name);
    this.publishSessionName(active.runtime.session);
    return { type: "done", message: `Session named: ${name}`, session: clientSessionFromRuntime(active.runtime) };
  }

  private compact(session: TSession, instructions: string): ClientCommandResult {
    this.lifecycle.onCompactionStart?.(session);
    void session.compact(instructions === "" ? undefined : instructions)
      .then((result) => {
        this.events.publish(session.sessionId, {
          type: "command.output",
          level: "success",
          message: formatCompactionResult(result),
        });
        this.lifecycle.onCompactionEnd?.(session, "success");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.events.publish(session.sessionId, { type: "command.output", level: "error", message: `Compaction failed: ${message}` });
        this.events.publish(session.sessionId, { type: "session.error", message });
        this.lifecycle.onCompactionEnd?.(session, "error", message);
      });
    return { type: "done", message: "Compaction started…" };
  }

  private async reload(session: TSession): Promise<ClientCommandResult> {
    if (this.lifecycle.reloadSession === undefined) return { type: "unsupported", message: "/reload is not available for this session runtime." };
    if (this.hasActiveWork(session)) {
      // Asking twice is not an error and must not queue twice: the second
      // /reload wants the same thing the first one is already waiting for.
      const alreadyQueued = this.pendingReloads.has(session.sessionId);
      this.pendingReloads.add(session.sessionId);
      return {
        type: "done",
        message: alreadyQueued
          ? "Reload is already queued and will run when the session goes idle."
          : "Session is busy - reload queued. It will run automatically once the session goes idle.",
      };
    }

    try {
      await this.lifecycle.reloadSession(session);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { type: "unsupported", message: `Reload failed: ${message}` };
    }
    return { type: "done", message: RELOAD_DONE_MESSAGE };
  }

  /**
   * Called on the session's idle edge. Runs a queued /reload if there is one
   * and the session really is quiet - the caller's idea of idle can be a
   * moment early (an agent_end still inside a turn), and reloadSession throws
   * in that case, so the check is repeated here rather than trusted.
   */
  runQueuedReload(session: TSession): void {
    if (!this.pendingReloads.has(session.sessionId)) return;
    if (this.hasActiveWork(session)) return;
    const reloadSession = this.lifecycle.reloadSession;
    if (reloadSession === undefined) {
      this.pendingReloads.delete(session.sessionId);
      return;
    }
    this.pendingReloads.delete(session.sessionId);
    void reloadSession(session)
      .then(() => {
        this.events.publish(session.sessionId, { type: "command.output", level: "success", message: RELOAD_DONE_MESSAGE });
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.events.publish(session.sessionId, { type: "command.output", level: "error", message: `Reload failed: ${message}` });
      });
  }

  /** Forget a queued reload for a session that is going away or being replaced. */
  cancelQueuedReload(sessionId: string): void {
    if (!this.pendingReloads.delete(sessionId)) return;
    this.events.publish(sessionId, { type: "command.output", level: "info", message: "Queued reload cancelled." });
  }

  private async clone(active: CommandActiveSession<TSession>): Promise<ClientCommandResult> {
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("clone");
    const initialLeafId = active.runtime.session.sessionManager.getLeafId();
    if (initialLeafId === null || initialLeafId === "") return { type: "unsupported", message: "Cannot clone: no current session entry" };
    const relatedName = await this.nextRelatedSessionName(active, "copy");
    if (this.lifecycle.isTreeNavigationActive?.(active.runtime.session) === true) return treeNavigationActiveUnsupported();
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("clone");
    // The active leaf may have changed while related-session names were loaded.
    // Clone the position that is current when the serialized replacement begins.
    const leafId = active.runtime.session.sessionManager.getLeafId();
    if (leafId === null || leafId === "") return { type: "unsupported", message: "Cannot clone: no current session entry" };
    const result = await this.runSessionReplacement(active.runtime, async () => {
      const cloneResult = await active.runtime.fork(leafId, { position: "at" });
      if (!cloneResult.cancelled) this.tryNameRelatedSession(active.runtime.session, relatedName);
      return cloneResult;
    });
    if (result.cancelled) return { type: "done", message: "Clone cancelled" };
    return { type: "done", message: "Session cloned", session: clientSessionFromRuntime(active.runtime) };
  }

  private fork(active: CommandActiveSession<TSession>): ClientCommandResult {
    if (this.hasActiveWork(active.runtime.session)) return forkActiveUnsupported("fork");
    const messages = active.runtime.session.getUserMessagesForForking();
    if (!messages.length) return { type: "unsupported", message: "No user messages to fork from" };
    const requestId = crypto.randomUUID();
    this.pendingSelects.set(requestId, { sessionId: active.runtime.session.sessionId, command: "fork" });
    return {
      type: "select",
      requestId,
      title: "Fork from message",
      options: [...messages].reverse().map((message) => ({ value: message.entryId, label: truncate(message.text, 140) })),
    };
  }

  private tree(session: TSession): ClientCommandResult {
    if (this.hasActiveWork(session)) {
      return { type: "unsupported", message: "Cannot open the session tree while the session is active. Stop current activity and try /tree again." };
    }
    if (this.lifecycle.getSessionTree === undefined) return treeUnavailableUnsupported();

    try {
      const tree = this.lifecycle.getSessionTree(session);
      if (tree === undefined) return treeUnavailableUnsupported();
      if (tree.nodes.length === 0) return { type: "unsupported", message: "Cannot navigate an empty session tree." };
      return { type: "tree", tree };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { type: "unsupported", message: `Unable to open the session tree: ${message}` };
    }
  }

  private hasActiveWork(session: TSession): boolean {
    return sessionHasActiveWork(session) || this.lifecycle.hasActiveWork?.(session) === true;
  }

  private forkPosition(session: TSession, entryId: string): "before" | "at" {
    const treeNode = this.lifecycle.getSessionTree?.(session)?.nodes.find((node) => node.id === entryId);
    if (treeNode !== undefined) return treeNode.kind === "user" ? "before" : "at";
    return session.getUserMessagesForForking().some((message) => message.entryId === entryId) ? "before" : "at";
  }

  private runSessionReplacement<T>(runtime: CommandRuntime<TSession>, operation: () => Promise<T>): Promise<T> {
    const runReplacement = this.lifecycle.runSessionReplacement;
    return runReplacement === undefined ? operation() : runReplacement(runtime.session, operation);
  }

  private async nextRelatedSessionName(active: CommandActiveSession<TSession>, kind: RelatedSessionKind): Promise<string> {
    const sourceTitle = relatedSessionSourceTitle(active.runtime.session);
    const sourceName = normalizedName(active.runtime.session.sessionName);
    let existingNames: readonly string[];
    try {
      existingNames = await this.naming.listSessionNames?.(active.runtime.cwd) ?? [];
    } catch {
      existingNames = [];
    }
    return uniqueRelatedSessionName(sourceTitle, kind, sourceName === undefined ? existingNames : [...existingNames, sourceName]);
  }

  private tryNameRelatedSession(session: TSession, name: string): void {
    try {
      session.setSessionName(name);
      this.publishSessionName(session);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.events.publish(session.sessionId, { type: "command.output", level: "error", message: `Session created, but naming failed: ${message}` });
    }
  }

  private publishSessionName(session: TSession): void {
    const event = session.sessionName === undefined
      ? { type: "session.name", sessionId: session.sessionId } as const
      : { type: "session.name", sessionId: session.sessionId, name: session.sessionName } as const;
    this.events.publish(session.sessionId, event);
    this.events.publishGlobal?.(event);
  }

  /**
   * Fed from the session's event stream. A watched command is cleared by the
   * first thing a reader could see; a turn that ends still-watched gets said
   * out loud, in the transcript and through the persistence hook.
   */
  observeSessionEvent(sessionId: string, event: unknown): void {
    const command = this.silentCommandWatches.get(sessionId);
    if (command === undefined) return;
    if (rendersInTranscript(event)) {
      this.silentCommandWatches.delete(sessionId);
      return;
    }
    if (eventField(event, "type") !== "agent_end") return;
    this.silentCommandWatches.delete(sessionId);
    this.events.publish(sessionId, {
      type: "command.output",
      level: "info",
      message: `${command} finished without any output.`,
    });
    this.lifecycle.onSilentCommand?.(sessionId, command);
  }

  private isRuntimeCommand(session: TSession, name: string): boolean {
    return session.extensionRunner.getRegisteredCommands().some((command) => command.invocationName === name)
      || session.promptTemplates.some((template) => template.name === name)
      || session.resourceLoader.getSkills().skills.some((skill) => `skill:${skill.name}` === name);
  }
}

/** Read one string field from an unknown event without asserting its shape. */
function eventField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record: Record<string, unknown> = { ...value };
  const field = record[key];
  return typeof field === "string" ? field : undefined;
}

/**
 * Whether this event puts something on the reader's screen. A user message is
 * the command's own echo; an assistant message counts only when it carries
 * text or an error, because the transcript renders an error line and renders
 * empty content as nothing at all.
 */
function rendersInTranscript(event: unknown): boolean {
  const type = eventField(event, "type");
  if (type === "tool_execution_start") return true;
  if (type !== "message_end") return false;
  if (typeof event !== "object" || event === null) return false;
  const record: Record<string, unknown> = { ...event };
  const message = record["message"];
  if (eventField(message, "role") !== "assistant") return false;
  if (eventField(message, "stopReason") === "error") return true;
  if (typeof message !== "object" || message === null) return false;
  const messageRecord: Record<string, unknown> = { ...message };
  const content = messageRecord["content"];
  if (typeof content === "string") return content.trim() !== "";
  return Array.isArray(content) && content.length > 0;
}

function clientSessionFromRuntime(runtime: CommandRuntime): ClientSession {
  const session = runtime.session;
  const parentSessionPath = typeof session.sessionManager.getHeader === "function" ? session.sessionManager.getHeader()?.parentSession : undefined;
  return {
    id: session.sessionId,
    path: session.sessionFile ?? "",
    cwd: runtime.cwd,
    ...(session.sessionName === undefined ? {} : { name: session.sessionName }),
    created: new Date().toISOString(),
    modified: new Date().toISOString(),
    messageCount: session.messages.length,
    firstMessage: "",
    ...(parentSessionPath === undefined ? {} : { parentSessionPath }),
  };
}

function relatedSessionSourceTitle(session: CommandSession): string {
  const name = normalizedName(session.sessionName);
  if (name !== undefined) return name;
  for (const message of session.messages) {
    const text = normalizedName(extractUserMessageText(message));
    if (text !== undefined) return truncate(text, 80);
  }
  return "Untitled session";
}

function uniqueRelatedSessionName(sourceTitle: string, kind: RelatedSessionKind, existingNames: readonly string[]): string {
  const baseName = stripRelatedSessionSuffix(sourceTitle) || "Untitled session";
  const label = kind === "fork" ? "Fork" : "Copy";
  const usedNames = new Set(existingNames.map(normalizedName).filter(isDefined));
  for (let counter = 1; ; counter += 1) {
    const candidate = `${baseName} — ${label} ${String(counter)}`;
    if (!usedNames.has(candidate)) return candidate;
  }
}

function stripRelatedSessionSuffix(name: string): string {
  return name.replace(/\s+(?:—|-)\s+(?:Fork|Copy|Clone)\s+\d+$/u, "").trim();
}

function extractUserMessageText(message: unknown): string | undefined {
  if (!isRecord(message) || message["role"] !== "user") return undefined;
  const content = message["content"];
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content.map((part) => {
    if (!isRecord(part) || part["type"] !== "text") return "";
    return typeof part["text"] === "string" ? part["text"] : "";
  }).join("");
}

function normalizedName(name: string | undefined): string | undefined {
  const trimmed = name?.replace(/\s+/g, " ").trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function sessionHasActiveWork(session: CommandSession): boolean {
  return session.isStreaming || session.isBashRunning || session.isCompacting || session.pendingMessageCount > 0;
}

function forkActiveUnsupported(command: "fork" | "clone"): ClientCommandResult {
  return { type: "unsupported", message: `Cannot ${command} while the session is active. Stop current activity before ${command === "fork" ? "forking" : "cloning"}.` };
}

function treeUnavailableUnsupported(): ClientCommandResult {
  return { type: "unsupported", message: "Session tree navigation is not available with this Pi runtime." };
}

function treeNavigationActiveUnsupported(): ClientCommandResult {
  return { type: "unsupported", message: "Cannot run commands while session tree navigation is active. Stop or finish the navigation first." };
}

function promptDraft(text: string | undefined): Partial<Pick<Extract<ClientCommandResult, { type: "done" }>, "promptDraft">> {
  return text === undefined ? {} : { promptDraft: text };
}

function formatSessionStats(session: CommandSession): string {
  const stats = session.getSessionStats();
  return [
    `Session: ${stats.sessionId}`,
    `Messages: ${String(stats.totalMessages)} (${String(stats.userMessages)} user, ${String(stats.assistantMessages)} assistant)`,
    `Tool calls: ${String(stats.toolCalls)}`,
    `Tokens: ↑${String(stats.tokens.input)} ↓${String(stats.tokens.output)} total ${String(stats.tokens.total)}`,
    `Cost: $${stats.cost.toFixed(4)}`,
  ].join("\n");
}

function formatCompactionResult(result: { summary: string; tokensBefore: number }): string {
  return [
    "Compaction complete.",
    `Tokens before: ${String(result.tokensBefore)}`,
    "",
    result.summary,
  ].join("\n");
}

function truncate(text: string, maxLength: number): string {
  const singleLine = text.replace(/\s+/g, " ").trim();
  return singleLine.length <= maxLength ? singleLine : `${singleLine.slice(0, maxLength - 1)}…`;
}
