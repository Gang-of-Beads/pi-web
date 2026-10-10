import { HttpError, sessionsApi } from "./api";
import { browserLocalStorage } from "./browserLocalStorage";
import { newClientMessageId } from "./messageDelivery";
import { isRecord } from "../../shared/unknownValues";
import { ROUTE_MISSING_CODE, type DraftChangeCause, type DraftSendClaim, type DraftWrite, type DraftWriteAnswer, type SessionDraft, type SessionRef } from "../../shared/apiTypes";

/**
 * One composer's draft against the copy on its session's daemon, so every device shows the same
 * draft (server-drafts.md, slice 1). This browser's own copy stays (`promptDraftStorage`): it is
 * what a page shows first, and all a machine without the draft routes gets.
 *
 * `draftSyncStep` decides every transition; `SessionDraftSync` only carries out what it says. A
 * page names itself with a fresh id and numbers its writes, so a send can name the writes it
 * covers and the daemon refuses one of them arriving after the send instead of bringing the sent
 * text back. A page that is typing when another device sends the draft keeps its text and says
 * nothing, and its next write puts the draft back (owner, D1: silent).
 */

/** How long typing has to pause before the draft is written. */
export const DRAFT_WRITE_DELAY_MS = 500;

const LOCAL_RECORD_PREFIX = "pi-web:prompt-draft-sync:";

type Revision = number | undefined;

/**
 * - `local-only`: this browser's copy only (not shown yet, or the machine has no draft routes).
 * - `unknown`: the daemon's copy is not known (a read is in flight, or failed); `dirty` says the
 *   text shown has edits the daemon has not had, `revision` what that text was based on,
 *   `reading` whether a read is in flight (so a second is not started), and `announced` the
 *   highest revision the daemon is known to have (-1 when none); a read answering below it is
 *   stale and is read again instead of shown.
 * - `synced`: the text shown is the daemon's revision.
 * - `dirty`: typed since; a write is due when typing pauses.
 * - `writing`: a write of `written` is on its way; `text` is what is shown now.
 * - `sent`: sent from here; the composer stays empty until the daemon says what the send left.
 */
export type DraftSyncState =
  | { readonly kind: "local-only" }
  | { readonly kind: "unknown"; readonly text: string; readonly dirty: boolean; readonly revision: Revision; readonly reading: boolean; readonly announced: number }
  | { readonly kind: "synced"; readonly text: string; readonly revision: number }
  | { readonly kind: "dirty"; readonly text: string; readonly base: Revision }
  | { readonly kind: "writing"; readonly text: string; readonly base: Revision; readonly written: string }
  | { readonly kind: "sent"; readonly base: Revision };

/** How this browser's copy relates to the daemon's, kept beside the text across a reload. */
export interface LocalDraftRecord {
  readonly revision?: number;
  readonly state: "synced" | "dirty" | "sent";
}

export type DraftSyncEvent =
  | { readonly kind: "opened"; readonly text: string; readonly record: LocalDraftRecord | undefined }
  | { readonly kind: "typed"; readonly text: string }
  | { readonly kind: "due"; readonly seq: number }
  | { readonly kind: "read-answered"; readonly draft: SessionDraft }
  | { readonly kind: "read-failed" }
  | { readonly kind: "write-answered"; readonly answer: DraftWriteAnswer }
  | { readonly kind: "write-failed" }
  | { readonly kind: "route-missing" }
  | { readonly kind: "announced"; readonly revision: number; readonly cause: DraftChangeCause; readonly fromHere: boolean }
  | { readonly kind: "sent-here" };

export type DraftSyncEffect =
  | { readonly kind: "read" }
  | { readonly kind: "write"; readonly text: string; readonly seq: number }
  | { readonly kind: "show"; readonly text: string }
  | { readonly kind: "wait" };

export interface DraftSyncStep {
  readonly state: DraftSyncState;
  readonly effects: readonly DraftSyncEffect[];
}

/** Every transition of a composer's draft (server-drafts.md, "The page's sync states"). */
export function draftSyncStep(state: DraftSyncState, event: DraftSyncEvent): DraftSyncStep {
  if (event.kind === "opened") return opened(state, event.text, event.record);
  if (event.kind === "route-missing") return { state: { kind: "local-only" }, effects: [] };
  if (state.kind === "local-only") return stay(state);
  switch (event.kind) {
    case "typed": return typed(state, event.text);
    case "due": return due(state, event.seq);
    case "read-answered": return readAnswered(state, event.draft);
    case "read-failed": return state.kind === "unknown" ? stay({ ...state, reading: false }) : stay(state);
    case "write-answered": return writeAnswered(state, event.answer);
    case "write-failed": return state.kind === "writing" ? stay({ kind: "dirty", text: state.text, base: state.base }) : stay(state);
    case "announced": return announced(state, event);
    case "sent-here": return stay({ kind: "sent", base: knownRevision(state) });
  }
}

/** The daemon revision this page last knew the draft at. */
export function knownRevision(state: DraftSyncState): Revision {
  switch (state.kind) {
    case "local-only": return undefined;
    case "unknown":
    case "synced": return state.revision;
    case "dirty":
    case "writing":
    case "sent": return state.base;
  }
}

/** What this browser keeps beside the text for a state; nothing for a draft the daemon never had. */
export function localRecordOf(state: DraftSyncState): LocalDraftRecord | undefined {
  switch (state.kind) {
    case "local-only": return undefined;
    case "unknown": return !state.dirty && state.revision === undefined ? undefined : withRevision(state.dirty ? "dirty" : "synced", state.revision);
    case "synced": return { revision: state.revision, state: "synced" };
    case "dirty":
    case "writing": return withRevision("dirty", state.base);
    case "sent": return withRevision("sent", state.base);
  }
}

function withRevision(state: LocalDraftRecord["state"], revision: Revision): LocalDraftRecord {
  return revision === undefined ? { state } : { revision, state };
}

function stay(state: DraftSyncState, effects: readonly DraftSyncEffect[] = []): DraftSyncStep {
  return { state, effects };
}

/**
 * The composer shows the session (again). A fresh page starts from this browser's copy; text
 * stored by an older build, with no record beside it, is this browser's unsent typing.
 */
function opened(state: DraftSyncState, text: string, record: LocalDraftRecord | undefined): DraftSyncStep {
  switch (state.kind) {
    case "local-only":
      if (record?.state === "sent") return stay({ kind: "sent", base: record.revision }, [{ kind: "read" }]);
      return stay({ kind: "unknown", text, dirty: record === undefined ? text !== "" : record.state === "dirty", revision: record?.revision, reading: true, announced: -1 }, [{ kind: "read" }]);
    case "unknown": return state.reading ? stay(state) : stay({ ...state, reading: true }, [{ kind: "read" }]);
    case "synced": return stay({ kind: "unknown", text: state.text, dirty: false, revision: state.revision, reading: true, announced: state.revision }, [{ kind: "read" }]);
    case "dirty": return stay(state, [{ kind: "wait" }]);
    case "writing": return stay(state);
    case "sent": return stay(state, [{ kind: "read" }]);
  }
}

function typed(state: Exclude<DraftSyncState, { kind: "local-only" }>, text: string): DraftSyncStep {
  switch (state.kind) {
    case "unknown": return text === state.text ? stay(state) : stay({ kind: "dirty", text, base: state.revision }, [{ kind: "wait" }]);
    case "synced": return text === state.text ? stay(state) : stay({ kind: "dirty", text, base: state.revision }, [{ kind: "wait" }]);
    case "dirty": return text === state.text ? stay(state) : stay({ ...state, text }, [{ kind: "wait" }]);
    case "writing": return stay({ ...state, text });
    case "sent": return text === "" ? stay(state) : stay({ kind: "dirty", text, base: state.base }, [{ kind: "wait" }]);
  }
}

function due(state: Exclude<DraftSyncState, { kind: "local-only" }>, seq: number): DraftSyncStep {
  if (state.kind !== "dirty") return stay(state);
  return stay({ kind: "writing", text: state.text, base: state.base, written: state.text }, [{ kind: "write", text: state.text, seq }]);
}

/**
 * The daemon's draft. Typing that has not reached it wins: its write lands later. A page that did
 * not type takes the daemon's, and after a send only a revision newer than the send's is taken,
 * so a read that raced the send cannot put the sent text back.
 */
function readAnswered(state: Exclude<DraftSyncState, { kind: "local-only" }>, draft: SessionDraft): DraftSyncStep {
  const text = draft.text ?? "";
  if (state.kind === "sent") return draft.revision > (state.base ?? -1) ? taken(draft.revision, text, "") : stay(state);
  if (state.kind !== "unknown") return stay(state);
  if (draft.revision < state.announced) return stay(state, [{ kind: "read" }]);
  if (text === state.text) return stay({ kind: "synced", text, revision: draft.revision });
  if (state.dirty) return stay({ kind: "dirty", text: state.text, base: draft.revision }, [{ kind: "wait" }]);
  return taken(draft.revision, text, state.text);
}

function taken(revision: number, text: string, shown: string): DraftSyncStep {
  return stay({ kind: "synced", text, revision }, text === shown ? [] : [{ kind: "show", text }]);
}

function writeAnswered(state: Exclude<DraftSyncState, { kind: "local-only" }>, answer: DraftWriteAnswer): DraftSyncStep {
  if (state.kind === "sent") return answer.superseded === true ? stay(state, [{ kind: "read" }]) : stay({ kind: "sent", base: Math.max(answer.revision, state.base ?? -1) });
  if (state.kind !== "writing") return stay(state);
  if (answer.superseded !== true && state.text === state.written) return stay({ kind: "synced", text: state.text, revision: answer.revision });
  return stay({ kind: "dirty", text: state.text, base: answer.revision }, [{ kind: "wait" }]);
}

/**
 * Another write or a send changed the daemon's draft. A page with typing of its own ignores it
 * (its write lands later and wins); after a send, only the send's own frame or another page's
 * write says something new, as this page's earlier writes are what was sent.
 */
function announced(state: Exclude<DraftSyncState, { kind: "local-only" }>, frame: { readonly revision: number; readonly cause: DraftChangeCause; readonly fromHere: boolean }): DraftSyncStep {
  switch (state.kind) {
    case "unknown": {
      const next = { ...state, announced: Math.max(state.announced, frame.revision) };
      return state.reading ? stay(next) : stay({ ...next, reading: true }, [{ kind: "read" }]);
    }
    case "synced": return frame.revision > state.revision ? stay({ kind: "unknown", text: state.text, dirty: false, revision: state.revision, reading: true, announced: frame.revision }, [{ kind: "read" }]) : stay(state);
    case "dirty":
    case "writing": return stay(state);
    case "sent": return (frame.cause === "sent" || !frame.fromHere) && frame.revision > (state.base ?? -1) ? stay(state, [{ kind: "read" }]) : stay(state);
  }
}

/** Where a composer shows its session: the machine, and the session as its daemon names it. */
export interface DraftScope {
  readonly key: string;
  readonly machineId: string;
  readonly session: SessionRef;
}

/** What the composer does for the sync: show the daemon's draft in place of its text. */
export interface DraftView {
  show(text: string): void;
}

export interface DraftSyncDeps {
  readDraft(scope: DraftScope): Promise<SessionDraft>;
  writeDraft(scope: DraftScope, write: DraftWrite): Promise<DraftWriteAnswer>;
  storage(): Storage | undefined;
}

const defaultDeps: DraftSyncDeps = {
  readDraft: (scope) => sessionsApi.readDraft(scope.session, scope.machineId),
  writeDraft: (scope, write) => sessionsApi.writeDraft(scope.session, write, scope.machineId),
  storage: () => browserLocalStorage(),
};

/** This page's name for its writes; a reload is a new page. */
export const PAGE_DEVICE_ID = newClientMessageId();
let issuedSeq = 0;

/** Carries out what `draftSyncStep` decides, for one session on one machine. */
export class SessionDraftSync {
  private state: DraftSyncState = { kind: "local-only" };
  private view: DraftView | undefined;
  private waiting: ReturnType<typeof setTimeout> | undefined;
  private recorded: string | undefined;

  constructor(private scope: DraftScope, private readonly deps: DraftSyncDeps = defaultDeps) {}

  /** The composer shows this session now, showing `text` from this browser's copy. */
  attach(view: DraftView, text: string, session: SessionRef): void {
    this.view = view;
    this.scope = { ...this.scope, session };
    this.step({ kind: "opened", text, record: readLocalRecord(this.deps.storage(), this.scope.key) });
  }

  /** The composer moved on: a write that was waiting for typing to pause goes now. */
  detach(): void {
    this.view = undefined;
    if (this.state.kind === "dirty") this.step({ kind: "due", seq: nextSeq() });
  }

  typed(text: string): void {
    this.step({ kind: "typed", text });
  }

  announced(revision: number, cause: DraftChangeCause, deviceId: string): void {
    this.step({ kind: "announced", revision, cause, fromHere: deviceId === PAGE_DEVICE_ID });
  }

  /** What a send from this composer covers, for the daemon to empty the draft it was made from; nothing on a machine without drafts. */
  sentHere(): DraftSendClaim | undefined {
    if (this.state.kind === "local-only") return undefined;
    const revision = knownRevision(this.state);
    this.step({ kind: "sent-here" });
    return { deviceId: PAGE_DEVICE_ID, seq: issuedSeq, ...(revision === undefined ? {} : { revision }) };
  }

  private step(event: DraftSyncEvent): void {
    const { state, effects } = draftSyncStep(this.state, event);
    this.state = state;
    this.record(localRecordOf(state));
    if (state.kind !== "dirty") this.stopWaiting();
    for (const effect of effects) this.run(effect);
  }

  private run(effect: DraftSyncEffect): void {
    switch (effect.kind) {
      case "read": this.read(); return;
      case "write": this.write(effect.text, effect.seq); return;
      case "show": this.view?.show(effect.text); return;
      case "wait": this.wait(); return;
    }
  }

  private record(record: LocalDraftRecord | undefined): void {
    const serialized = record === undefined ? undefined : JSON.stringify(record);
    if (serialized === this.recorded) return;
    this.recorded = serialized;
    writeLocalRecord(this.deps.storage(), this.scope.key, serialized);
  }

  private read(): void {
    void this.deps.readDraft(this.scope).then(
      (draft) => { this.step({ kind: "read-answered", draft }); },
      (error: unknown) => { this.step(isRouteMissing(error) ? { kind: "route-missing" } : { kind: "read-failed" }); },
    );
  }

  private write(text: string, seq: number): void {
    void this.deps.writeDraft(this.scope, { deviceId: PAGE_DEVICE_ID, seq, text }).then(
      (answer) => { this.step({ kind: "write-answered", answer }); },
      (error: unknown) => { this.step(isRouteMissing(error) ? { kind: "route-missing" } : { kind: "write-failed" }); },
    );
  }

  private wait(): void {
    this.stopWaiting();
    this.waiting = setTimeout(() => {
      this.waiting = undefined;
      this.step({ kind: "due", seq: nextSeq() });
    }, DRAFT_WRITE_DELAY_MS);
  }

  private stopWaiting(): void {
    if (this.waiting === undefined) return;
    clearTimeout(this.waiting);
    this.waiting = undefined;
  }
}

const syncs = new Map<string, SessionDraftSync>();

/** The one sync of a session's draft on this page, kept while the page lives so a write in flight outlives a session switch. */
export function draftSyncFor(scope: DraftScope): SessionDraftSync {
  const existing = syncs.get(scope.key);
  if (existing !== undefined) return existing;
  const created = new SessionDraftSync(scope);
  syncs.set(scope.key, created);
  return created;
}

/** A `draft.changed` frame for a session; one no composer on this page has shown has nothing to update. */
export function announceDraftChange(key: string, frame: { readonly revision: number; readonly cause: DraftChangeCause; readonly deviceId: string }): void {
  syncs.get(key)?.announced(frame.revision, frame.cause, frame.deviceId);
}

function nextSeq(): number {
  issuedSeq += 1;
  return issuedSeq;
}

function isRouteMissing(error: unknown): boolean {
  return error instanceof HttpError && error.code === ROUTE_MISSING_CODE;
}

function readLocalRecord(storage: Storage | undefined, key: string): LocalDraftRecord | undefined {
  try {
    const raw = storage?.getItem(`${LOCAL_RECORD_PREFIX}${key}`);
    return raw === null || raw === undefined ? undefined : localDraftRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
}

function writeLocalRecord(storage: Storage | undefined, key: string, serialized: string | undefined): void {
  try {
    if (serialized === undefined) storage?.removeItem(`${LOCAL_RECORD_PREFIX}${key}`);
    else storage?.setItem(`${LOCAL_RECORD_PREFIX}${key}`, serialized);
  } catch {
    return;
  }
}

const LOCAL_STATES: Readonly<Record<LocalDraftRecord["state"], true>> = { synced: true, dirty: true, sent: true };

function isLocalState(value: unknown): value is LocalDraftRecord["state"] {
  return typeof value === "string" && Object.hasOwn(LOCAL_STATES, value);
}

function localDraftRecord(value: unknown): LocalDraftRecord | undefined {
  if (!isRecord(value) || !isLocalState(value["state"])) return undefined;
  const revision = value["revision"];
  return withRevision(value["state"], typeof revision === "number" && Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined);
}
