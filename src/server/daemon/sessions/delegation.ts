/**
 * The delegation operations the daemon offers as session routes: start an
 * independent session, start a tracked child, list, check and read children.
 *
 * They used to be agent tools PI WEB registered on every session. Owner,
 * 2026-09-30: PI WEB gives the agent no tools of its own; the operations stay as an
 * interface a plugin or extension can build tools on (docs/design/no-builtin-agent-tools.md).
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TranscriptContentKind, TranscriptRole, TranscriptView } from "./subsessionTranscript.js";

export interface SpawnSessionResult {
  sessionId: string;
  cwd: string;
  /** Model the spawned session runs with, as `provider/id`; absent when unknown. */
  model?: string;
}

export type SpawnSessionModel = NonNullable<ExtensionContext["model"]>;
export type SpawnSessionThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

export interface SpawnSessionInvocation {
  spawningCwd: string;
  /** Id of the dispatching session; used to resolve {@link modelSpec} against its model runtime. */
  spawningSessionId: string;
  prompt: string;
  cwd: string | undefined;
  /** Current model from the dispatching session, used as the spawned session's default. */
  model?: SpawnSessionModel;
  /** Strict `provider/model-id` requested by the dispatcher; overrides {@link model} when set. */
  modelSpec?: string;
  /** Dispatching session's current thinking level, inherited by the spawned session (pi clamps it to the spawned model's capabilities). */
  thinkingLevel?: SpawnSessionThinkingLevel;
}

/** Lifecycle phase of a tracked subsession as seen by its parent. */
export type SubsessionStatus = "working" | "idle" | "error" | "unknown";

export interface SpawnSubsessionResult {
  sessionId: string;
  cwd: string;
  /** Model the child session runs with, as `provider/id`; absent when unknown. */
  model?: string;
}

export type SpawnSubsessionModel = NonNullable<ExtensionContext["model"]>;
export type SpawnSubsessionThinkingLevel = NonNullable<ExtensionContext["thinkingLevel"]>;

export interface SpawnSubsessionInvocation {
  /**
   * cwd of the parent session. A tracked child always runs in
   * this workspace, so it is both the project-scope check input and the target.
   */
  spawningCwd: string;
  /** Session id of the parent; the spawned session is tracked against it. */
  parentSessionId: string;
  /** Session file of the parent, recorded in the child's `parentSession` header. */
  parentSessionFile: string | undefined;
  prompt: string;
  /**
   * Requested target workspace. The subsession route never sets it; other callers may, and
   * anything other than {@link spawningCwd} is refused rather than retargeted.
   */
  cwd?: string;
  /** Current model from the dispatching session, used as the spawned session's default. */
  model?: SpawnSubsessionModel;
  /** Strict `provider/model-id` requested by the parent; overrides {@link model} when set. */
  modelSpec?: string;
  /** Parent's current thinking level, inherited by the child session (pi clamps it to the child model's capabilities). */
  thinkingLevel?: SpawnSubsessionThinkingLevel;
}

export interface SubsessionSummary {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
}

/** Quick glance at a subsession: status plus its most recent assistant output. */
export interface SubsessionCheckResult {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
  finalText: string;
  messageCount: number;
}

/** Exploratory transcript read: a filtered, paginated slice of the subsession's history. */
export interface SubsessionReadResult extends TranscriptView {
  sessionId: string;
  cwd: string;
  status: SubsessionStatus;
}

/** Filters the parent passes to narrow a transcript read; mirrors {@link TranscriptQuery}. */
export interface SubsessionReadQuery {
  roles?: TranscriptRole[];
  include?: TranscriptContentKind[];
  search?: string;
  maxChars?: number;
  includeToolArgs?: boolean;
  before?: number;
  limit?: number;
}

/** What a caller asks a spawn route for: the first prompt, and optionally an exact `provider/model-id`. */
export interface DelegationRequest {
  prompt: string;
  model?: string;
}
