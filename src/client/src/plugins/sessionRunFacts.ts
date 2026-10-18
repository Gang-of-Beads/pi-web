import type { RealtimeEvent, SessionActivity, SessionUiEvent } from "../../../shared/apiTypes";
import type { SessionRunOutcome } from "../../../shared/pluginApiTypes";
import { failureKind, type FailureKind } from "../chatMessages";
import { isRecord } from "../../../shared/unknownValues";

/** Where a status frame came from: the session's own stream (the session on screen), or its machine's announcements. */
type FrameSource = "stream" | "machine";

/** How the run's last reply ended, from pi's own fields (`chatMessages.failureKind`). */
type ReplyEnd = "finished" | FailureKind;

interface Run {
  readonly startedOn: FrameSource;
  /**
   * The page did not hold the run's stream throughout: a frame of the session came through its
   * machine's announcements, the stream's connection went away, its lost frames could not be
   * replayed, or the page left the session while the run was open.
   */
  leftStream: boolean;
  /** The cut the stream announced (`session.stopped`): the reader's Stop, or the runtime closing under the run. */
  cutHeard: CutEvidence | undefined;
  /** The phase of the latest activity frame heard in the run: an error a later frame moved past (pi retried, or the run went on) is not how the run ended. */
  lastPhase: SessionActivity["phase"] | undefined;
  lastReply: ReplyEnd | undefined;
}

/** What the page has evidence of when a run ends; each names exactly one outcome. */
type RunEvidence = "stop" | "interrupt" | "failure" | "clean-stream" | "none";
type CutEvidence = Extract<RunEvidence, "stop" | "interrupt">;

const OUTCOME: Readonly<Record<RunEvidence, SessionRunOutcome>> = {
  stop: "stopped",
  interrupt: "interrupted",
  failure: "failed",
  "clean-stream": "completed",
  none: "unknown",
};

const REPLY_EVIDENCE: Readonly<Record<ReplyEnd, RunEvidence>> = {
  "stopped-by-you": "stop",
  interrupted: "interrupt",
  failed: "failure",
  finished: "clean-stream",
};

/** The cut a `session.stopped` frame announces, in the transcript's words (owner, 2026-09-30: you stopped it, or it was interrupted). */
const STOPPED_CAUSE_EVIDENCE: Readonly<Record<Extract<SessionUiEvent, { type: "session.stopped" }>["cause"], CutEvidence>> = {
  user: "stop",
  closed: "interrupt",
};

/**
 * What a run's end is evidence of (design 4.B, owner 2026-10-18: never claim "completed" without
 * evidence). A cut heard wins: the reader's Stop is a stop, the runtime closing under the run an
 * interruption, the same words as the server facts and the transcript. A failure is the server
 * facts' rule (owner decision): the run ended on an error pi did not retry, that is its last
 * reply's stopReason "error" or an error activity when it settles; a `session.error` heard mid-run
 * (an extension error, a model default not saved) is not how the run ended. "completed" needs the
 * run to have begun and ended on the session's own stream, with no machine frame of it between,
 * and its last reply finished. A gap in that stream (its connection went away, the page left the
 * session) rules out "completed": the page cannot know what the run did while it was not listening,
 * so the run ends on a cut, an interrupted reply or a failure the page heard, and "unknown" otherwise.
 */
function runEvidence(run: Run, endedOn: FrameSource): RunEvidence {
  if (run.cutHeard !== undefined) return run.cutHeard;
  if (run.lastPhase === "error") return "failure";
  if (run.lastReply === undefined) return "none";
  const evidence = REPLY_EVIDENCE[run.lastReply];
  if (evidence !== "clean-stream") return evidence;
  return run.startedOn === "stream" && endedOn === "stream" && !run.leftStream ? evidence : "none";
}

export interface SessionRunFactSink {
  started(machineId: string, sessionId: string): void;
  ended(machineId: string, sessionId: string, outcome: SessionRunOutcome): void;
}

/**
 * Runs as the page sees them, from the frames it already receives (design 4.B): the stream of the
 * session on screen, and each held machine's announcements. A start is announced only when the
 * page knew the session idle before (a status frame, or the statuses the page read): a run already
 * going when the page began hearing its machine has no start, while its end is announced. While the
 * page holds a session's stream, its machine's status and activity frames for that session are left to the
 * stream, whose frames come in order after its stop and its reply.
 */
export class SessionRunWatch {
  /** Per machine, the runs the page saw going, and the sessions it knows idle. */
  private readonly runs = new Map<string, Map<string, Run>>();
  private readonly idle = new Map<string, Set<string>>();
  private version = 0;

  constructor(private readonly sink: SessionRunFactSink, private readonly holdsStream: (machineId: string, sessionId: string) => boolean) {}

  /** A frame of the session on screen's stream; `sessionId` is the session the stream belongs to. */
  streamFrame(machineId: string, sessionId: string, event: SessionUiEvent): void {
    if (event.type === "status.update") this.status(machineId, event.status.sessionId, event.status.isStreaming, "stream");
    else if (event.type === "session.stopped") this.mark(machineId, sessionId, (run) => { run.cutHeard = run.cutHeard === "stop" ? "stop" : STOPPED_CAUSE_EVIDENCE[event.cause]; });
    else if (event.type === "activity.update") this.activity(machineId, event.activity);
    else if (event.type === "message.end") this.reply(machineId, sessionId, event.message);
  }

  /**
   * The page stopped hearing this session's own stream while a run of it may be open: the
   * connection went away, frames it missed could not be replayed, or the page left the session.
   * Whatever the stream says afterwards, the page did not hear the whole run.
   */
  streamLost(machineId: string, sessionId: string): void {
    this.mark(machineId, sessionId, (run) => { run.leftStream = true; });
  }

  /** A frame of a machine's announcements. */
  machineFrame(machineId: string, event: RealtimeEvent): void {
    if (event.type === "status.update") {
      if (this.holdsStream(machineId, event.status.sessionId)) return;
      this.mark(machineId, event.status.sessionId, (run) => { run.leftStream = true; });
      this.status(machineId, event.status.sessionId, event.status.isStreaming, "machine");
    } else if (event.type === "activity.update" && !this.holdsStream(machineId, event.activity.sessionId)) {
      this.activity(machineId, event.activity);
    }
  }

  /** Statuses the page read: a session not running is known idle, so its next run's start is seen. Never a transition. */
  knownStatuses(machineId: string, statuses: Iterable<{ readonly sessionId: string; readonly isStreaming: boolean }>): void {
    const runs = this.runs.get(machineId);
    for (const status of statuses) {
      if (status.isStreaming || runs?.has(status.sessionId) === true) continue;
      const idle = this.idleOf(machineId);
      if (idle.has(status.sessionId)) continue;
      idle.add(status.sessionId);
      this.version += 1;
    }
  }

  /** The page may have missed what this machine announced: what it knew of its runs is no longer known. */
  forgetMachine(machineId: string): void {
    this.runs.delete(machineId);
    this.idle.delete(machineId);
    this.version += 1;
  }

  /** Whether a turn runs, as far as the page knows; undefined when it does not know. */
  running(machineId: string, sessionId: string): boolean | undefined {
    if (this.runs.get(machineId)?.has(sessionId) === true) return true;
    return this.idle.get(machineId)?.has(sessionId) === true ? false : undefined;
  }

  /** Changes whenever what `running` answers may have changed. */
  get revision(): number {
    return this.version;
  }

  private status(machineId: string, sessionId: string, isStreaming: boolean, source: FrameSource): void {
    const runs = this.runsOf(machineId);
    const idle = this.idleOf(machineId);
    const run = runs.get(sessionId);
    if (isStreaming) {
      if (run !== undefined) return;
      const wasIdle = idle.delete(sessionId);
      runs.set(sessionId, { startedOn: source, leftStream: false, cutHeard: undefined, lastPhase: undefined, lastReply: undefined });
      this.version += 1;
      if (wasIdle) this.sink.started(machineId, sessionId);
      return;
    }
    if (idle.has(sessionId)) return;
    idle.add(sessionId);
    this.version += 1;
    if (run === undefined) return;
    runs.delete(sessionId);
    this.sink.ended(machineId, sessionId, OUTCOME[runEvidence(run, source)]);
  }

  private activity(machineId: string, activity: SessionActivity): void {
    this.mark(machineId, activity.sessionId, (run) => { run.lastPhase = activity.phase; });
  }

  private reply(machineId: string, sessionId: string, message: unknown): void {
    if (!isRecord(message) || message["role"] !== "assistant") return;
    const stopReason = message["stopReason"];
    const ended: ReplyEnd = stopReason === "error" || stopReason === "aborted" ? failureKind(message) : "finished";
    this.mark(machineId, sessionId, (run) => { run.lastReply = ended; });
  }

  private mark(machineId: string, sessionId: string, change: (run: Run) => void): void {
    const run = this.runs.get(machineId)?.get(sessionId);
    if (run !== undefined) change(run);
  }

  private runsOf(machineId: string): Map<string, Run> {
    const known = this.runs.get(machineId);
    if (known !== undefined) return known;
    const created = new Map<string, Run>();
    this.runs.set(machineId, created);
    return created;
  }

  private idleOf(machineId: string): Set<string> {
    const known = this.idle.get(machineId);
    if (known !== undefined) return known;
    const created = new Set<string>();
    this.idle.set(machineId, created);
    return created;
  }
}
