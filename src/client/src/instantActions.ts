/**
 * Archive, restore, delete, close and remove act at once (owner, 2026-10-21; docs/design/instant-actions.md).
 *
 * The press moves the item where it will be, in the same frame: an archived session moves into
 * Archived, a deleted one leaves. The machine is then asked and its answer settles the move: a
 * refusal moves the item back with the reason, an unknown outcome (no answer, a timeout, a 5xx, a
 * gateway's 502/503/504) is not a refusal, so the item stays moved, marked "Not confirmed yet",
 * until a read of the machine says whether it happened (absence is not negation).
 *
 * What the machine can reverse is sent at once and Undo sends the reverse. What it cannot
 * (deleting for good, closing a project, which comes back with a new id when added again, removing
 * a machine) is held for the Undo window and sent only when the window ends; Undo then means
 * nothing was sent.
 *
 * One pure state machine; `InstantActionController` executes it.
 */

import { HttpError } from "./api/http";
import type { PiPackageScope, SessionCleanupRequest, SessionInfo } from "./api";
import type { MachineReachabilityView } from "./machineReachability";

export type InstantActionKind = "archive" | "restore" | "delete-archived" | "close-project" | "remove-machine" | "remove-package" | "remove-page-access" | "cleanup-run" | "delete-workspace";

/** Sent at once (the machine can reverse it), or held for the Undo window (it cannot). */
export type InstantDelivery = "at-once" | "held";

export const INSTANT_DELIVERY: Readonly<Record<InstantActionKind, InstantDelivery>> = {
  archive: "at-once",
  restore: "at-once",
  "delete-archived": "held",
  "close-project": "held",
  "remove-machine": "held",
  "remove-package": "held",
  "remove-page-access": "held",
  "cleanup-run": "held",
  "delete-workspace": "held",
};

/** Where the Undo bar of an action docks: the Navigate page that acted, the bottom of the app, or nowhere (the archived strip is the open session's undo). */
export type InstantDock = "navigate" | "app" | "none";

/** One thing an action moves, with the scope it belongs to under the action's machine. */
export interface InstantTarget {
  readonly id: string;
  readonly label: string;
  readonly projectId: string | undefined;
  readonly workspacePath: string | undefined;
  /** A Pi package's scope, which names it together with its source. */
  readonly packageScope?: PiPackageScope | undefined;
  /** The removal state a workspace's provider warned about at the press, sent as it was: what the bar named is what is removed. */
  readonly workspaceRemovalPrecondition?: string | undefined;
}

export interface InstantReturn {
  readonly target: InstantTarget;
  readonly reason: string;
}

/**
 * - optimistic: pressed and shown moved; not yet delivered
 * - held: shown moved, nothing sent, waiting out the Undo window
 * - sent: shown moved, the request is on its way
 * - unconfirmed: the request got no answer; shown moved until a read of the machine settles it
 * - undoing: shown back; the reverse request is on its way
 * - confirmed: the machine did it
 * - reverted: shown back; undone, or the machine refused or did not do it
 */
export type InstantPhase = "optimistic" | "held" | "sent" | "unconfirmed" | "undoing" | "confirmed" | "reverted";

export interface InstantAction {
  readonly id: number;
  readonly kind: InstantActionKind;
  /** The machine whose lists the action changes, and its name for the words. */
  readonly machineId: string;
  readonly machineName: string;
  readonly dock: InstantDock;
  /** The rows the action still moves. */
  readonly targets: readonly InstantTarget[];
  /** The rows that went back, and why. */
  readonly returned: readonly InstantReturn[];
  readonly phase: InstantPhase;
  /** When it was pressed, the archived time the moved row carries until the machine's own. */
  readonly pressedAt: string;
  /** What the bar says the action does, when the kind's own words are not enough: a provider's warning, what a cleanup will do. */
  readonly note?: string | undefined;
  /** The thresholds a cleanup run was previewed with, sent as they were. */
  readonly cleanupRequest?: SessionCleanupRequest | undefined;
}

/** What a request, or a read after one, says about each target. */
export interface InstantAnswer {
  readonly doneIds: readonly string[];
  readonly refused: readonly { readonly id: string; readonly reason: string }[];
  readonly unansweredIds: readonly string[];
}

export type InstantEvent =
  | { readonly type: "deliver" }
  | { readonly type: "window-ended" }
  | { readonly type: "undo" }
  | { readonly type: "answered"; readonly answer: InstantAnswer }
  | { readonly type: "read"; readonly answer: InstantAnswer }
  /** Where the action still stands once its reverse answered: done where it stands, unanswered where that is not known yet. */
  | { readonly type: "reverse-answered"; readonly standing: InstantAnswer };

const DELIVERED: Readonly<Record<InstantDelivery, InstantPhase>> = { "at-once": "sent", held: "held" };

type Transition = (action: InstantAction, event: InstantEvent) => InstantAction | undefined;

const TRANSITIONS: Readonly<Record<InstantPhase, Transition>> = {
  optimistic: (action, event) => (event.type === "deliver" ? { ...action, phase: DELIVERED[INSTANT_DELIVERY[action.kind]] } : undefined),
  held: (action, event) => {
    if (event.type === "undo") return { ...action, phase: "reverted" };
    if (event.type === "window-ended") return { ...action, phase: "sent" };
    return undefined;
  },
  sent: (action, event) => {
    if (event.type === "answered") return settled(action, event.answer);
    if (event.type === "undo") return { ...action, phase: "undoing" };
    return undefined;
  },
  unconfirmed: (action, event) => {
    if (event.type === "read") return settled(action, event.answer);
    if (event.type === "undo") return { ...action, phase: "undoing" };
    return undefined;
  },
  confirmed: (action, event) => (event.type === "undo" ? { ...action, phase: "undoing" } : undefined),
  undoing: (action, event) => (event.type === "reverse-answered" ? { ...action, ...keptBy(action, event.standing) } : undefined),
  reverted: () => undefined,
};

export function instantTransition(action: InstantAction, event: InstantEvent): InstantAction {
  return TRANSITIONS[action.phase](action, event) ?? action;
}

/**
 * An answer splits the rows: done ones stay moved, refused ones go back with the reason, and
 * unanswered ones stay moved until a read settles them. A read that cannot find a row's answer
 * keeps it waiting.
 */
function settled(action: InstantAction, answer: InstantAnswer): InstantAction {
  const reasons = new Map(answer.refused.map((entry) => [entry.id, entry.reason]));
  const kept = keptBy(action, answer);
  const returned = action.targets
    .filter((target) => !kept.targets.includes(target))
    .map((target) => ({ target, reason: reasons.get(target.id) ?? NOT_DONE_WORDS[action.kind](action.machineName) }));
  return { ...action, ...kept, returned: [...action.returned, ...returned] };
}

/**
 * The rows an answer keeps moved - done, or not known yet - and the phase that leaves. After an
 * Undo the answer is where the action still stands: a row where it does not stand is undone, which
 * is what the reader asked for, so it goes back with no reason to report.
 */
function keptBy(action: InstantAction, answer: InstantAnswer): Pick<InstantAction, "targets" | "phase"> {
  const done = new Set(answer.doneIds);
  const waiting = new Set(answer.unansweredIds);
  const targets = action.targets.filter((target) => done.has(target.id) || waiting.has(target.id));
  const phase: InstantPhase = targets.length === 0 ? "reverted" : targets.some((target) => waiting.has(target.id)) ? "unconfirmed" : "confirmed";
  return { targets, phase };
}

/**
 * A read made while a request may still be landing, before its deadline: a row still in place may
 * yet move, so it is not an answer. A row the read shows moved is, unless the request being settled
 * is an Undo's reverse, which a read from before it landed would show the same way.
 */
export function answerWhileLanding(action: InstantAction, answer: InstantAnswer, movedIsAnswer: boolean): InstantAnswer {
  const done = movedIsAnswer ? answer.doneIds : [];
  return { doneIds: done, refused: [], unansweredIds: action.targets.map((target) => target.id).filter((id) => !done.includes(id)) };
}

const NOT_DONE_WORDS: Readonly<Record<InstantActionKind, (machine: string) => string>> = {
  archive: (machine) => `${machine} did not archive it`,
  restore: (machine) => `${machine} did not restore it`,
  "delete-archived": (machine) => `${machine} did not delete it`,
  "close-project": (machine) => `${machine} did not close it`,
  "remove-machine": () => "it was not removed",
  "remove-package": (machine) => `${machine} did not remove it`,
  "remove-page-access": () => "its access was not removed",
  "cleanup-run": (machine) => `${machine} still has sessions this cleanup matches`,
  "delete-workspace": (machine) => `${machine} did not start removing it`,
};

/** The request that reverses one sent at once; the held ones are never sent while Undo is offered. */
export const REVERSE: Readonly<Record<InstantActionKind, InstantActionKind | undefined>> = {
  archive: "restore",
  restore: "archive",
  "delete-archived": undefined,
  "close-project": undefined,
  "remove-machine": undefined,
  "remove-package": undefined,
  "remove-page-access": undefined,
  "cleanup-run": undefined,
  "delete-workspace": undefined,
};

/** Whether the rows show moved in a phase. */
const SHOWS_MOVED: Readonly<Record<InstantPhase, boolean>> = {
  optimistic: true,
  held: true,
  sent: true,
  unconfirmed: true,
  undoing: false,
  confirmed: true,
  reverted: false,
};

/** Whether a phase shows its rows moved before the machine settled it: what waits on an action in flight waits through these. */
export const STILL_MOVING: Readonly<Record<InstantPhase, boolean>> = {
  optimistic: true,
  held: true,
  sent: true,
  unconfirmed: true,
  undoing: false,
  confirmed: false,
  reverted: false,
};

/** Whether a phase can still take Undo while its window is open. */
export const UNDOABLE: Readonly<Record<InstantPhase, boolean>> = {
  optimistic: false,
  held: true,
  sent: true,
  unconfirmed: true,
  undoing: false,
  confirmed: true,
  reverted: false,
};

/**
 * How a failed request reads. A 4xx is the machine's answer: it refused, with a reason. Anything
 * else - no answer, a timeout, a 5xx, a gateway that could not reach the machine (502/503/504 or a
 * transport claim), 408, 429 - is not an answer, and the request may or may not have landed.
 */
export type InstantFailure = "refused" | "unknown";

/** A refusal this page states for the machine, from what it already knows (a workspace no longer listed): an answer, not a lost request. */
export class InstantRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstantRefusal";
  }
}

const NOT_AN_ANSWER: ReadonlySet<number> = new Set([408, 429]);

export function instantFailure(error: unknown): InstantFailure {
  if (error instanceof InstantRefusal) return "refused";
  if (!(error instanceof HttpError)) return "unknown";
  if (error.transport !== undefined || NOT_AN_ANSWER.has(error.status)) return "unknown";
  return error.status >= 400 && error.status < 500 ? "refused" : "unknown";
}

/** A failed request as an answer for every target: all refused with the machine's words, or all unanswered. */
export function failedAnswer(ids: readonly string[], error: unknown, reason: string): InstantAnswer {
  if (instantFailure(error) === "refused") return { doneIds: [], refused: ids.map((id) => ({ id, reason })), unansweredIds: [] };
  return { doneIds: [], refused: [], unansweredIds: ids };
}

/** Answers for separate targets, such as one request each, as one answer. */
export function mergedAnswers(answers: readonly InstantAnswer[]): InstantAnswer {
  return {
    doneIds: answers.flatMap((answer) => answer.doneIds),
    refused: answers.flatMap((answer) => answer.refused),
    unansweredIds: answers.flatMap((answer) => answer.unansweredIds),
  };
}

/**
 * Whether a press is taken. A machine known to be out of reach refuses at once: nothing moves and
 * nothing is queued. What counts as out of reach depends on who does the work: session work needs
 * the machine's session daemon (its probe answering with an error such as a stopped daemon, or its
 * announcements socket closed past the request deadline, refuses it); project, package and
 * workspace work needs the machine's web process (only a machine that does not answer at all
 * refuses it); this PI WEB's own roster and approved pages are kept by the gateway serving the
 * page, which never refuses here. A machine not probed yet is admitted; its answer decides.
 */
export type InstantAdmission = { readonly kind: "admitted" } | { readonly kind: "refused"; readonly reason: string };

/** What the page knows of a machine's reach: its probe, and its session daemon's announcements socket. */
export interface InstantReach {
  readonly machine: MachineReachabilityView;
  readonly daemon: MachineReachabilityView;
}

type InstantWorker = "session-daemon" | "machine-web" | "gateway";

const WORKER: Readonly<Record<InstantActionKind, InstantWorker>> = {
  archive: "session-daemon",
  restore: "session-daemon",
  "delete-archived": "session-daemon",
  "close-project": "machine-web",
  "remove-machine": "gateway",
  "remove-package": "machine-web",
  "remove-page-access": "gateway",
  "cleanup-run": "session-daemon",
  "delete-workspace": "machine-web",
};

const REFUSING: Readonly<Record<InstantWorker, (reach: InstantReach) => MachineReachabilityView | undefined>> = {
  "session-daemon": (reach) => [reach.machine, reach.daemon].find((view) => view.state === "offline" || view.state === "error"),
  "machine-web": (reach) => (reach.machine.state === "offline" ? reach.machine : undefined),
  gateway: () => undefined,
};

export function instantAdmission(kind: InstantActionKind, reach: InstantReach): InstantAdmission {
  const refusing = REFUSING[WORKER[kind]](reach);
  return refusing === undefined ? { kind: "admitted" } : { kind: "refused", reason: refusing.text };
}

const SESSION_KINDS: ReadonlySet<InstantActionKind> = new Set(["archive", "restore", "delete-archived"]);

/**
 * A machine's sessions as they show with its actions applied: archived ones moved into Archived,
 * restored ones out, deleted ones gone. An action being undone shows its reverse, since the lists
 * may already carry what the machine confirmed.
 */
export function sessionsWithInstantActions(sessions: readonly SessionInfo[], machineId: string, actions: readonly InstantAction[]): readonly SessionInfo[] {
  return actions
    .filter((action) => action.machineId === machineId && SESSION_KINDS.has(action.kind))
    .reduce<readonly SessionInfo[]>((listed, action) => {
      const kind = SHOWN_KIND[action.phase](action.kind);
      return kind === undefined ? listed : SESSION_MOVES[kind](listed, new Set(action.targets.map((target) => target.id)), action.pressedAt);
    }, sessions);
}

/** The move a phase shows: the action's own while it stands, its reverse while it is undone, none once it went back. */
const SHOWN_KIND: Readonly<Record<InstantPhase, (kind: InstantActionKind) => InstantActionKind | undefined>> = {
  optimistic: (kind) => kind,
  held: (kind) => kind,
  sent: (kind) => kind,
  unconfirmed: (kind) => kind,
  undoing: (kind) => REVERSE[kind],
  confirmed: (kind) => kind,
  reverted: () => undefined,
};

type SessionMove = (sessions: readonly SessionInfo[], ids: ReadonlySet<string>, at: string) => readonly SessionInfo[];

const unchanged: SessionMove = (sessions) => sessions;

const SESSION_MOVES: Readonly<Record<InstantActionKind, SessionMove>> = {
  archive: (sessions, ids, at) => sessions.map((session) => (ids.has(session.id) && session.archived !== true ? { ...session, archived: true, archivedAt: at } : session)),
  restore: (sessions, ids) => sessions.map((session) => (ids.has(session.id) && session.archived === true ? withoutArchive(session) : session)),
  "delete-archived": (sessions, ids) => sessions.filter((session) => !ids.has(session.id)),
  "close-project": unchanged,
  "remove-machine": unchanged,
  "remove-package": unchanged,
  "remove-page-access": unchanged,
  "cleanup-run": unchanged,
  "delete-workspace": unchanged,
};

/** A session as it lists once restored: with no archive mark. */
export function withoutArchive(session: SessionInfo): SessionInfo {
  const restored = { ...session };
  delete restored.archived;
  delete restored.archivedAt;
  return restored;
}

/** A list of things by id with what an action of `kind` hides from it on `machineId` (projects closing, machines being removed). */
export function withoutInstantTargets<T extends { readonly id: string }>(items: readonly T[], kind: InstantActionKind, machineId: string, actions: readonly InstantAction[]): readonly T[] {
  const hidden = instantHiddenIds(kind, machineId, actions);
  return hidden.size === 0 ? items : items.filter((item) => !hidden.has(item.id));
}

/** The ids an action of `kind` on `machineId` shows gone right now. */
export function instantHiddenIds(kind: InstantActionKind, machineId: string, actions: readonly InstantAction[]): ReadonlySet<string> {
  return new Set(actions
    .filter((action) => action.kind === kind && action.machineId === machineId && SHOWS_MOVED[action.phase])
    .flatMap((action) => action.targets.map((target) => target.id)));
}

/** The id a Pi package goes by in an action: its scope and its source, which together name it. */
export function piPackageTargetId(scope: PiPackageScope, source: string): string {
  return `${scope}:${source}`;
}

/** The row kinds a mark can stand on. */
export type InstantRowKind = "session" | "project" | "machine" | "package" | "page-access" | "cleanup" | "workspace";

const ROW_KIND: Readonly<Record<InstantActionKind, InstantRowKind>> = {
  archive: "session",
  restore: "session",
  "delete-archived": "session",
  "close-project": "project",
  "remove-machine": "machine",
  "remove-package": "package",
  "remove-page-access": "page-access",
  "cleanup-run": "cleanup",
  "delete-workspace": "workspace",
};

/** What a moved or returned row says under its name: still on its way, not confirmed yet, or back with the reason. */
export interface InstantRowMark {
  readonly tone: "pending" | "returned";
  readonly words: string;
}

const PENDING_WORDS: Readonly<Record<InstantActionKind, string>> = {
  archive: "Archiving…",
  restore: "Restoring…",
  "delete-archived": "Deleting…",
  "close-project": "Closing…",
  "remove-machine": "Removing…",
  "remove-package": "Removing…",
  "remove-page-access": "Removing…",
  "cleanup-run": "Cleaning up…",
  "delete-workspace": "Removing…",
};

const ROW_MARK: Readonly<Record<InstantPhase, (action: InstantAction) => string | undefined>> = {
  optimistic: (action) => PENDING_WORDS[action.kind],
  held: () => undefined,
  sent: (action) => PENDING_WORDS[action.kind],
  unconfirmed: () => "Not confirmed yet",
  undoing: () => undefined,
  confirmed: () => undefined,
  reverted: () => undefined,
};

/** The marks a machine's rows carry, keyed `kind:id`. */
export function instantRowMarks(actions: readonly InstantAction[], machineId: string): ReadonlyMap<string, InstantRowMark> {
  const marks = new Map<string, InstantRowMark>();
  for (const action of actions) {
    if (action.machineId !== machineId) continue;
    const kind = ROW_KIND[action.kind];
    for (const entry of action.returned) marks.set(`${kind}:${entry.target.id}`, { tone: "returned", words: `Not done · ${entry.reason}` });
    const words = ROW_MARK[action.phase](action);
    if (words !== undefined) for (const target of action.targets) marks.set(`${kind}:${target.id}`, { tone: "pending", words });
  }
  return marks;
}

/** The Undo bar's sentence: the verb (in the danger tone for what cannot be undone on the machine) and what it acts on. */
export interface InstantBarWords {
  readonly verb: string;
  readonly subject: string;
  readonly danger: boolean;
  /** What the action names in Undo's accessible name, e.g. "archiving “X”". */
  readonly undoName: string;
}

interface KindWords {
  readonly verb: string;
  readonly gerund: string;
  readonly plural: (count: number) => string;
  readonly consequence: string | undefined;
}

const KIND_WORDS: Readonly<Record<InstantActionKind, KindWords>> = {
  archive: { verb: "Archived", gerund: "archiving", plural: (count) => `${String(count)} sessions`, consequence: undefined },
  restore: { verb: "Restored", gerund: "restoring", plural: (count) => `${String(count)} sessions`, consequence: undefined },
  "delete-archived": { verb: "Deleting", gerund: "deleting", plural: (count) => `${String(count)} archived sessions`, consequence: "permanently" },
  "close-project": { verb: "Closing", gerund: "closing", plural: (count) => `${String(count)} projects`, consequence: "the folder stays" },
  "remove-machine": { verb: "Removing", gerund: "removing", plural: (count) => `${String(count)} machines`, consequence: "nothing on it changes" },
  "remove-package": { verb: "Removing", gerund: "removing", plural: (count) => `${String(count)} Pi packages`, consequence: "install it again to get it back" },
  "remove-page-access": { verb: "Removing access for", gerund: "removing access for", plural: (count) => `${String(count)} pages`, consequence: "it must be approved again to connect" },
  "cleanup-run": { verb: "Cleaning up", gerund: "cleaning up", plural: (count) => `${String(count)} projects`, consequence: undefined },
  "delete-workspace": { verb: "Removing", gerund: "removing", plural: (count) => `${String(count)} workspaces`, consequence: undefined },
};

export function instantBarWords(action: InstantAction): InstantBarWords {
  const words = KIND_WORDS[action.kind];
  const only = action.targets.length === 1 ? action.targets[0] : undefined;
  const named = only === undefined ? words.plural(action.targets.length) : `“${only.label}”`;
  const consequence = action.note ?? words.consequence;
  const subject = consequence === undefined ? named : `${named} ${action.kind === "delete-archived" ? consequence : `· ${consequence}`}`;
  return { verb: words.verb, subject, danger: INSTANT_DELIVERY[action.kind] === "held", undoName: `${words.gerund} ${named}` };
}

/** What the app row says when rows go back: which, on which machine, and why. */
export function instantReturnWords(action: InstantAction): string | undefined {
  if (action.returned.length === 0) return undefined;
  const first = action.returned[0];
  if (first === undefined) return undefined;
  const lead = action.returned.length === 1 ? `“${first.target.label}”` : `${String(action.returned.length)} of ${String(action.returned.length + action.targets.length)}`;
  return `Not ${PAST_WORDS[action.kind]} on ${action.machineName}: ${lead} · ${first.reason}`;
}

/** What the app row says when a press is refused because the machine is out of reach. */
export function instantRefusalWords(kind: InstantActionKind, machineName: string, reason: string): string {
  return `${machineName} is not reachable (${reason}), so nothing was ${PAST_WORDS[kind]}. Try again when it is back.`;
}

/** What the app row says when an Undo is refused by the machine: the action stands. */
export function instantUndoRefusedWords(action: InstantAction, reason: string): string {
  return `Could not undo ${KIND_WORDS[action.kind].gerund} on ${action.machineName}: ${reason}`;
}

const PAST_WORDS: Readonly<Record<InstantActionKind, string>> = {
  archive: "archived",
  restore: "restored",
  "delete-archived": "deleted",
  "close-project": "closed",
  "remove-machine": "removed",
  "remove-package": "removed",
  "remove-page-access": "removed",
  "cleanup-run": "cleaned up",
  "delete-workspace": "removed",
};
