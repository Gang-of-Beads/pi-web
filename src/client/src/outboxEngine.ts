import type { DeviceOperation, OperationAppliedOutcome, OperationBatch, OperationBatchAnswer, OperationResult } from "../../shared/apiTypes";
import { HttpError } from "./api/http";
import { sendRefusedForGood } from "./messageLifecycle";
import { ackedThrough, confirmThrough, deviceId } from "./operationLog";
import { delayAfter, driverMove, type DriverEffect, type DriverEvent, type DriverState } from "./outboxDriver";
import { classifyReadError, type ReadMiss } from "./sync/readPhase";
import { findOperation, loadPendingPrompts, OUTBOX_CHANGED_EVENT, outboxSessionKeyOf, outboxSessionKeys, savesFilesFirst, updateOperation, type OperationScope, type PendingPrompt, type RewriteOutcome } from "./pendingOutbox";

/**
 * Sends every outbox of this browser, wherever the reader is (docs/design/message-states.md,
 * "Operations"). Each session's outbox has its own driver (outboxDriver.ts): its unanswered
 * operations go as one ordered batch, numbered from where the machine last said this device
 * stands, and the next batch goes only once the machine has answered. A batch nobody answered is
 * sent again, numbered the same; what the machine already ran it answers by identity.
 *
 * The engine owns sending and the outbox's records; what an answer means for the page - a row, a
 * composer, a command's result - is the effects' business, so the engine works the same for the
 * session on screen and for one the reader left.
 */

export interface OutboxEffects {
  /** An operation the machine applied, by its HTTP answer or its stream frame; called once per record. */
  applied(sessionKey: string, record: PendingPrompt, outcome: OperationAppliedOutcome): void;
  /** An operation the machine refused for good: it is cancelled, its words go back. */
  refused(sessionKey: string, record: PendingPrompt, reason: string): void;
}

export interface OutboxEngineDeps extends OutboxEffects {
  apply(scope: OperationScope, batch: OperationBatch): Promise<OperationBatchAnswer>;
  /** Create the session a scope still being created stands for and move its outbox to the session's id; false for a session the machine has. Throws when the start went unanswered. */
  startPending(scope: OperationScope): Promise<boolean>;
  /** Ready a record to travel - a message whose files go to the workspace is rewritten with their paths - and return it; the engine stores it. */
  prepare(record: PendingPrompt): Promise<PendingPrompt>;
  /** Something about the outboxes changed that the page shows: which sessions are sending, which machines are unanswered. */
  changed(): void;
  now?: () => number;
}

interface OutboxRun {
  state: DriverState;
  delay: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** When the requests now unanswered began - the creation, the files, the batch; undefined once anything was heard for this outbox. */
  unansweredSince: number | undefined;
  /** Why it is unanswered, as the app row words it: the machine not answering until a failure says more. */
  miss: ReadMiss;
  machineId: string;
  /** Batches carry one operation at a time after a batch was too large for the way to the machine. */
  oneAtATime: boolean;
  /** When the last batch went. */
  sentAt: number;
}

const MAX_BATCH_OPERATIONS = 32;
const HEARD_KICK_MS = 2000;
/** Above this many bytes of inline files a batch stops growing, so one large photo does not drag every message with it. */
const MAX_BATCH_FILE_BYTES = 4 * 1024 * 1024;

export class OutboxEngine {
  private readonly runs = new Map<string, OutboxRun>();
  private readonly now: () => number;
  private started = false;

  constructor(private readonly deps: OutboxEngineDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Begin sending everything this browser holds, and keep listening for writes here and in other tabs. */
  start(): void {
    if (this.started) return;
    this.started = true;
    window.addEventListener(OUTBOX_CHANGED_EVENT, this.onChanged);
    window.addEventListener("storage", this.onStorage);
    window.addEventListener("online", this.kickAll);
    this.kickAll();
  }

  stop(): void {
    this.started = false;
    window.removeEventListener(OUTBOX_CHANGED_EVENT, this.onChanged);
    window.removeEventListener("storage", this.onStorage);
    window.removeEventListener("online", this.kickAll);
    for (const run of this.runs.values()) clearTimeout(run.timer);
    this.runs.clear();
  }

  /** The link may be back, or the page came into view: every outbox sends now. */
  readonly kickAll = (): void => {
    for (const sessionKey of outboxSessionKeys()) this.drive(sessionKey, "kick");
  };

  kick(sessionKey: string): void {
    this.drive(sessionKey, "kick");
  }

  /**
   * Something came from this machine, so the link to it works: an outbox waiting out its resend
   * wait sends now (owner, 2026-10-14: the probe "can be triggered by events"). At most once per
   * `HEARD_KICK_MS`, so a stream that keeps talking while one request path stays broken does not
   * turn into a send per frame.
   */
  heardFrom(machineId: string): void {
    const now = this.now();
    for (const [sessionKey, run] of this.runs) {
      if (run.machineId === machineId && run.state === "waiting" && now - run.sentAt >= HEARD_KICK_MS) this.drive(sessionKey, "kick");
    }
  }

  /**
   * Each outbox with a batch nobody has answered yet: since the batch was first sent, however many
   * times it was sent again (the row's "Trying to sync", owner 2026-10-14).
   */
  unanswered(): readonly { machineId: string; since: number; miss: ReadMiss }[] {
    return [...this.runs.values()].flatMap((run) => (run.unansweredSince === undefined ? [] : [{ machineId: run.machineId, since: run.unansweredSince, miss: run.miss }]));
  }

  /**
   * The stream confirmed one of this device's operations: the second path of the
   * acknowledgement, so a lost HTTP answer costs nothing. Only an operation still waiting under
   * that number is settled; the HTTP answer that may follow finds it gone.
   */
  streamApplied(sessionKey: string, frame: { deviceId: string; seq: number; clientMessageId?: string; outcome: OperationAppliedOutcome; appliedThrough: number }): void {
    if (frame.deviceId !== deviceId() || frame.clientMessageId === undefined) return;
    confirmThrough(sessionKey, frame.appliedThrough);
    this.heard(sessionKey);
    const record = findOperation(sessionKey, frame.clientMessageId);
    if (record?.seq !== frame.seq) return;
    this.deps.applied(sessionKey, record, frame.outcome);
    this.deps.changed();
  }

  private readonly onChanged = (event: Event): void => {
    const sessionKey: unknown = event instanceof CustomEvent ? event.detail : undefined;
    if (typeof sessionKey === "string") this.drive(sessionKey, "kick");
    this.deps.changed();
  };

  private readonly onStorage = (event: StorageEvent): void => {
    const sessionKey = event.key === null ? undefined : outboxSessionKeyOf(event.key);
    if (sessionKey === undefined) return;
    this.drive(sessionKey, "kick");
    this.deps.changed();
  };

  private runOf(sessionKey: string): OutboxRun {
    const existing = this.runs.get(sessionKey);
    if (existing !== undefined) return existing;
    const machineId = sessionKey.split(":")[0] ?? "local";
    const created: OutboxRun = { state: "idle", delay: 0, timer: undefined, unansweredSince: undefined, miss: { kind: "machine-unanswering", machineId }, machineId, oneAtATime: false, sentAt: 0 };
    this.runs.set(sessionKey, created);
    return created;
  }

  private drive(sessionKey: string, event: DriverEvent): void {
    if (!this.started) return;
    const run = this.runOf(sessionKey);
    const move = driverMove(run.state, event);
    run.state = move.to;
    run.delay = delayAfter(move.delay, run.delay);
    this.effects[move.effect](sessionKey, run);
  }

  private readonly effects: Readonly<Record<DriverEffect, (sessionKey: string, run: OutboxRun) => void>> = {
    sendBatch: (sessionKey) => { void this.sendBatch(sessionKey); },
    wait: (sessionKey, run) => {
      clearTimeout(run.timer);
      run.timer = setTimeout(() => { this.drive(sessionKey, "elapsed"); }, run.delay);
    },
    none: (sessionKey, run) => {
      clearTimeout(run.timer);
      if (run.state === "idle") this.forget(sessionKey, run);
    },
  };

  private forget(sessionKey: string, run: OutboxRun): void {
    const hadClaim = run.unansweredSince !== undefined;
    this.runs.delete(sessionKey);
    if (hadClaim) this.deps.changed();
  }

  private heard(sessionKey: string): void {
    const run = this.runs.get(sessionKey);
    if (run?.unansweredSince === undefined) return;
    run.unansweredSince = undefined;
    this.deps.changed();
  }

  /** One batch of a session's outbox; what it came to is the driver's next event. */
  private async sendBatch(sessionKey: string): Promise<void> {
    const records = loadPendingPrompts(sessionKey);
    const head = records[0];
    if (head === undefined) {
      this.drive(sessionKey, "drained");
      return;
    }
    const run = this.runOf(sessionKey);
    const claimedNow = run.unansweredSince === undefined;
    if (claimedNow) {
      run.unansweredSince = this.now();
      run.machineId = head.scope.machineId;
      run.miss = { kind: "machine-unanswering", machineId: head.scope.machineId };
    }
    const unclaim = (): void => { if (claimedNow) run.unansweredSince = undefined; };
    try {
      if (await this.deps.startPending(head.scope)) {
        this.heard(sessionKey);
        this.drive(sessionKey, "drained");
        this.kickAll();
        return;
      }
      const batch = await this.batchOf(sessionKey, records);
      if (batch === undefined) {
        unclaim();
        this.drive(sessionKey, "answered");
        return;
      }
      run.sentAt = this.now();
      const answer = await this.deps.apply(head.scope, batch.request);
      this.heard(sessionKey);
      this.settle(sessionKey, batch.records, answer);
      this.drive(sessionKey, "answered");
    } catch (error) {
      if (error instanceof OutboxStorageError) unclaim();
      this.drive(sessionKey, this.afterFailure(sessionKey, head, error));
    }
    this.deps.changed();
  }

  /**
   * The next batch: numbered from where the machine last said this device stands, each record
   * stored with its number before it goes. Only the head is prepared, so a failure to save files is
   * always the head's; a later record that saves files first ends the batch before it. The batch
   * ends, too, at a record that changed while it was read - a message withdrawn into its take-back -
   * and is undefined when even the head did, so the next round reads it again. Storage that refuses
   * the number fails the batch, which waits and tries again, rather than going round at once.
   */
  private async batchOf(sessionKey: string, records: readonly PendingPrompt[]): Promise<{ records: PendingPrompt[]; request: OperationBatch } | undefined> {
    const acked = ackedThrough(sessionKey);
    const limit = this.runOf(sessionKey).oneAtATime ? 1 : MAX_BATCH_OPERATIONS;
    const numbered: PendingPrompt[] = [];
    let bytes = 0;
    for (const record of records) {
      const size = fileBytes(record);
      if (numbered.length >= limit || (numbered.length > 0 && (bytes + size > MAX_BATCH_FILE_BYTES || savesFilesFirst(record)))) break;
      const prepared = numbered.length === 0 ? await this.deps.prepare(record) : record;
      const seq = acked + 1 + numbered.length;
      const stamped = prepared.seq === seq ? prepared : { ...prepared, seq };
      if (stamped !== record && REWRITE_ENDS_BATCH[updateOperation(sessionKey, stamped)]()) break;
      numbered.push(stamped);
      bytes += size;
    }
    if (numbered.length === 0) return undefined;
    return { records: numbered, request: { deviceId: deviceId(), ackedThrough: acked, operations: numbered.map(deviceOperation) } };
  }

  /** Apply the machine's answer to the records it names; anything not applied stays for the next batch. */
  private settle(sessionKey: string, records: readonly PendingPrompt[], answer: OperationBatchAnswer): void {
    confirmThrough(sessionKey, answer.standing.appliedThrough);
    this.runOf(sessionKey).oneAtATime = false;
    for (const result of answer.results) {
      const sent = records.find((record) => record.clientMessageId === result.clientMessageId);
      const record = sent === undefined ? undefined : findOperation(sessionKey, sent.clientMessageId);
      if (record?.seq !== result.seq) continue;
      this.resultEffects[result.status](sessionKey, record, result);
    }
  }

  private readonly resultEffects: Readonly<Record<OperationResult["status"], (sessionKey: string, record: PendingPrompt, result: OperationResult) => void>> = {
    applied: (sessionKey, record, result) => { if (result.status === "applied") this.deps.applied(sessionKey, record, result.outcome); },
    refused: (sessionKey, record, result) => { if (result.status === "refused") this.deps.refused(sessionKey, record, result.error); },
    stopped: (sessionKey, _record, result) => { if (result.status === "stopped") confirmThrough(sessionKey, result.appliedThrough); },
    notAttempted: () => undefined,
  };

  /**
   * A batch that got no answer goes again after the wait. One the way to the machine refused as too
   * large goes again at once, one operation at a time: a 413 is an answer - something on the way
   * read the request and said no - so it neither waits nor claims the row. A single operation it
   * still refuses, or a batch the machine could not read, cancels its head, so one bad record can
   * never hold the outbox forever.
   */
  private afterFailure(sessionKey: string, head: PendingPrompt, error: unknown): DriverEvent {
    const run = this.runOf(sessionKey);
    if (error instanceof HttpError && error.status === 413 && !run.oneAtATime) {
      run.oneAtATime = true;
      return "answered";
    }
    if (error instanceof OutboxStorageError) return "unanswered";
    if (!sendRefusedForGood(error)) {
      const outcome = classifyReadError(error);
      if (outcome.kind === "miss") run.miss = outcome.miss;
      return "unanswered";
    }
    this.heard(sessionKey);
    this.deps.refused(sessionKey, head, error instanceof Error ? error.message : String(error));
    return "answered";
  }
}

/**
 * Storage refused to record a batch's numbers: the batch is not sent and waits like one
 * unanswered. Nothing went to the machine, so it claims no machine on the row.
 */
class OutboxStorageError extends Error {
  constructor() {
    super("This browser could not store the batch's numbers (its storage is full or unavailable).");
    this.name = "OutboxStorageError";
  }
}

/** Whether a rewrite's outcome ends the batch before that record: only a record that became another operation does. */
const REWRITE_ENDS_BATCH: Readonly<Record<RewriteOutcome, () => boolean>> = {
  written: () => false,
  changed: () => true,
  failed: () => { throw new OutboxStorageError(); },
};

function fileBytes(record: PendingPrompt): number {
  return (record.attachments ?? []).reduce((total, attachment) => total + ("data" in attachment && typeof attachment.data === "string" ? attachment.data.length : 0), 0);
}

const OPERATION_OF: Readonly<Record<PendingPrompt["kind"], (record: PendingPrompt, seq: number) => DeviceOperation>> = {
  message: (record, seq) => ({
    kind: "message",
    seq,
    clientMessageId: record.clientMessageId,
    text: record.text,
    ...(record.behavior === undefined ? {} : { streamingBehavior: record.behavior }),
    ...(record.attachments === undefined || record.attachments.length === 0 ? {} : { attachments: record.attachments }),
    sentAt: record.at,
  }),
  takeBack: (record, seq) => ({ kind: "takeBack", seq, clientMessageId: record.clientMessageId, target: record.takeBackOf ?? "", text: record.text, ...(record.behavior === undefined ? {} : { lane: record.behavior }) }),
  command: (record, seq) => ({ kind: "command", seq, clientMessageId: record.clientMessageId, text: record.text.trim() }),
  shell: (record, seq) => ({ kind: "shell", seq, clientMessageId: record.clientMessageId, text: record.text }),
};

function deviceOperation(record: PendingPrompt): DeviceOperation {
  return OPERATION_OF[record.kind](record, record.seq ?? 0);
}
