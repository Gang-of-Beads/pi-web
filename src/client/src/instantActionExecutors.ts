import type { PiPackageScope, SessionCleanupRequest, SessionInfo, SessionRef } from "./api";
import type { InstantKindExecutor } from "./controllers/instantActionController";
import type { ProjectController } from "./controllers/projectController";
import type { SessionController } from "./controllers/sessionController";
import { describeError } from "./notice";
import { sessionLocationVerdict } from "./sessionLocationVerdict";
import { failedAnswer, mergedAnswers, piPackageTargetId, sessionsWithInstantActions, type InstantAction, type InstantActionKind, type InstantAnswer, type InstantTarget } from "./instantActions";

/** What the instant actions need from the app: the controllers that ask the machines, and reads of what the machines hold. */
export interface InstantExecutorDependencies {
  readonly sessions: Pick<SessionController, "archiveSessions" | "applyArchivedSessions" | "restoreSessions" | "applyRestoredSessions" | "deleteArchivedSessions" | "applyDeletedSessions">;
  /** Close a project on a machine (throws when it refused or did not answer; the folder is not touched), and carry a closed one into the app. */
  readonly projects: Pick<ProjectController, "applyClosedProject"> & { readonly close: (projectId: string, machineId: string, keepalive: boolean) => Promise<void> };
  /** A machine's sessions from a whole read made now; undefined when it could not be read whole. */
  readonly readSessions: (machineId: string) => Promise<SessionsRead | undefined>;
  /** A machine's projects from a read made now; undefined when it could not be read. */
  readonly readProjects: (machineId: string) => Promise<readonly { readonly id: string }[] | undefined>;
  /** This PI WEB's machines from a read made now; undefined when it could not be read. */
  readonly readMachines: () => Promise<readonly { readonly id: string }[] | undefined>;
  /** Carry a confirmed session move into the machine's board at once, then read it again. */
  readonly moveBoard: (machineId: string, move: (sessions: readonly SessionInfo[]) => readonly SessionInfo[]) => void;
  /** Remove a machine from this PI WEB (throws when the gateway refused or did not answer), and carry a removal the gateway did into the page. */
  readonly machines: {
    readonly remove: (machineId: string, keepalive: boolean) => Promise<void>;
    readonly applyRemoved: (machineId: string) => Promise<void>;
  };
  /** A machine's Pi packages: remove one (throws as above), read them now, and tell the reader what a removal asks of them next. */
  readonly packages: {
    readonly remove: (machineId: string, target: InstantTarget, keepalive: boolean) => Promise<void>;
    readonly read: (machineId: string) => Promise<readonly { readonly source: string; readonly scope: PiPackageScope }[] | undefined>;
    readonly applyRemoved: (machineId: string) => Promise<void>;
  };
  /** The other machines' pages this machine approved: forget one (throws as above), and read them now. */
  readonly pageAccess: {
    readonly forget: (origin: string, keepalive: boolean) => Promise<void>;
    readonly read: () => Promise<readonly { readonly origin: string }[] | undefined>;
  };
  /** A previewed cleanup: run it and show its result (throws as above), how many sessions it still matches when read now, and the lists read again once it is done. */
  readonly cleanup: {
    readonly run: (machineId: string, request: SessionCleanupRequest, keepalive: boolean) => Promise<void>;
    readonly remaining: (machineId: string, request: SessionCleanupRequest) => Promise<number | undefined>;
    readonly applyDone: (machineId: string) => void;
  };
  /**
   * A workspace's removal: start its provider's run and follow it (throws as above), whether a read
   * made now finds the run its press started (undefined when it cannot tell), and the removal runs
   * read again once one started.
   */
  readonly workspaceRemoval: {
    readonly start: (machineId: string, target: InstantTarget, keepalive: boolean) => Promise<void>;
    readonly started: (machineId: string, target: InstantTarget) => Promise<boolean | undefined>;
    readonly applyStarted: (machineId: string) => void;
  };
}

/**
 * A whole read of a machine's sessions: every session listed, and the workspaces it covers. A
 * session missing from it is gone only when one of those workspaces holds its directory; a session
 * outside them all (a closed project's, not pinned) is not in this read at all.
 */
export interface SessionsRead {
  readonly sessions: readonly SessionInfo[];
  readonly workspacePaths: readonly string[];
}

/**
 * Each kind of instant action against the machine and the app: how it is sent, how a read says
 * whether it happened, and how the app carries it once the machine did it. The rows are named by
 * the scope each target carries (machine, workspace, session), never by the current selection.
 */
export function instantKindExecutors(deps: InstantExecutorDependencies): Readonly<Record<InstantActionKind, InstantKindExecutor>> {
  const keepaliveInit = (keepalive: boolean) => (keepalive ? { keepalive: true } : undefined);
  const sessionMove = (action: InstantAction) => {
    deps.moveBoard(action.machineId, (sessions) => sessionsWithInstantActions(sessions, action.machineId, [{ ...action, phase: "confirmed" }]));
  };
  return {
    archive: {
      send: (action, keepalive) => answered(action, () => deps.sessions.archiveSessions(sessionRefs(action), action.machineId, keepaliveInit(keepalive))),
      read: (action) => readSessions(action, deps, (session) => session === undefined || session.archived === true),
      apply: async (action) => {
        sessionMove(action);
        await deps.sessions.applyArchivedSessions(ids(action), action.machineId, action.pressedAt);
      },
    },
    restore: {
      send: (action) => answered(action, () => deps.sessions.restoreSessions(sessionRefs(action), action.machineId)),
      read: (action) => readSessions(action, deps, (session) => session?.archived !== true),
      apply: async (action) => {
        sessionMove(action);
        await deps.sessions.applyRestoredSessions(ids(action), action.machineId);
      },
    },
    "delete-archived": {
      send: (action, keepalive) => answered(action, () => deps.sessions.deleteArchivedSessions(sessionRefs(action), action.machineId, keepaliveInit(keepalive))),
      read: (action) => readSessions(action, deps, (session) => session === undefined),
      apply: async (action) => {
        sessionMove(action);
        await deps.sessions.applyDeletedSessions(ids(action), action.machineId);
      },
    },
    "close-project": {
      send: (action, keepalive) => eachAnswered(action, (id) => deps.projects.close(id, action.machineId, keepalive)),
      read: (action) => readByListing(action, () => deps.readProjects(action.machineId), (project) => project === undefined),
      apply: (action) => {
        for (const id of ids(action)) deps.projects.applyClosedProject(id, action.machineId);
        return Promise.resolve();
      },
    },
    "remove-machine": {
      send: (action, keepalive) => eachAnswered(action, (id) => deps.machines.remove(id, keepalive)),
      read: (action) => readByListing(action, deps.readMachines, (machine) => machine === undefined),
      apply: async (action) => {
        for (const id of ids(action)) await deps.machines.applyRemoved(id);
      },
    },
    "remove-package": {
      send: (action, keepalive) => eachTargetAnswered(action, (target) => deps.packages.remove(action.machineId, target, keepalive)),
      read: (action) => readByListing(action, async () => (await deps.packages.read(action.machineId))?.map((entry) => ({ id: piPackageTargetId(entry.scope, entry.source) })), (entry) => entry === undefined),
      apply: (action) => deps.packages.applyRemoved(action.machineId),
    },
    "remove-page-access": {
      send: (action, keepalive) => eachAnswered(action, (origin) => deps.pageAccess.forget(origin, keepalive)),
      read: (action) => readByListing(action, async () => (await deps.pageAccess.read())?.map((entry) => ({ id: entry.origin })), (entry) => entry === undefined),
      apply: () => Promise.resolve(),
    },
    "cleanup-run": {
      send: (action, keepalive) => answered(action, async () => {
        await deps.cleanup.run(action.machineId, cleanupRequestOf(action), keepalive);
        return { doneIds: ids(action), refused: [], unansweredIds: [] };
      }),
      read: async (action) => {
        const remaining = await deps.cleanup.remaining(action.machineId, cleanupRequestOf(action)).catch((): undefined => undefined);
        if (remaining === undefined) return { doneIds: [], refused: [], unansweredIds: ids(action) };
        return { doneIds: remaining === 0 ? ids(action) : [], refused: [], unansweredIds: [] };
      },
      apply: (action) => {
        deps.cleanup.applyDone(action.machineId);
        return Promise.resolve();
      },
    },
    "delete-workspace": {
      send: (action, keepalive) => eachTargetAnswered(action, (target) => deps.workspaceRemoval.start(action.machineId, target, keepalive)),
      read: async (action) => {
        const answers = await Promise.all(action.targets.map(async (target) => ({ id: target.id, started: await deps.workspaceRemoval.started(action.machineId, target).catch((): undefined => undefined) })));
        return {
          doneIds: answers.flatMap((answer) => (answer.started === true ? [answer.id] : [])),
          refused: [],
          unansweredIds: answers.flatMap((answer) => (answer.started === undefined ? [answer.id] : [])),
        };
      },
      apply: (action) => {
        deps.workspaceRemoval.applyStarted(action.machineId);
        return Promise.resolve();
      },
    },
  };
}

/** The thresholds a cleanup was previewed with, and the projects it covers: its targets. */
function cleanupRequestOf(action: InstantAction): SessionCleanupRequest {
  return { ...action.cleanupRequest, projectCwds: action.targets.map((target) => target.id) };
}

function ids(action: InstantAction): string[] {
  return action.targets.map((target) => target.id);
}

function sessionRefs(action: InstantAction): SessionRef[] {
  return action.targets.map((target) => ({ id: target.id, cwd: target.workspacePath ?? "" }));
}

/** One request for every target; a failure answers for all of them. */
async function answered(action: InstantAction, send: () => Promise<InstantAnswer>): Promise<InstantAnswer> {
  try {
    return await send();
  } catch (error) {
    return failedAnswer(ids(action), error, describeError(error));
  }
}

/** One request per target, in turn; each failure answers for its own target. */
function eachAnswered(action: InstantAction, send: (id: string) => Promise<void>): Promise<InstantAnswer> {
  return eachTargetAnswered(action, (target) => send(target.id));
}

async function eachTargetAnswered(action: InstantAction, send: (target: InstantTarget) => Promise<void>): Promise<InstantAnswer> {
  const answers: InstantAnswer[] = [];
  for (const target of action.targets) {
    try {
      await send(target);
      answers.push({ doneIds: [target.id], refused: [], unansweredIds: [] });
    } catch (error) {
      answers.push(failedAnswer([target.id], error, describeError(error)));
    }
  }
  return mergedAnswers(answers);
}

/**
 * What a whole read of the sessions says per target: what the listed session (or its absence)
 * shows where the read covers the target's workspace, and no answer where it does not.
 */
async function readSessions(action: InstantAction, deps: Pick<InstantExecutorDependencies, "readSessions">, happened: (session: SessionInfo | undefined) => boolean): Promise<InstantAnswer> {
  const read = await deps.readSessions(action.machineId).catch((): undefined => undefined);
  if (read === undefined) return { doneIds: [], refused: [], unansweredIds: ids(action) };
  const byId = new Map(read.sessions.map((session) => [session.id, session]));
  const covered = (target: InstantTarget) => byId.has(target.id) || read.workspacePaths.some((path) => sessionLocationVerdict(target.workspacePath ?? "", path) === "described");
  return {
    doneIds: action.targets.filter((target) => covered(target) && happened(byId.get(target.id))).map((target) => target.id),
    refused: [],
    unansweredIds: action.targets.filter((target) => !covered(target)).map((target) => target.id),
  };
}

/** What a listing read now says per target: done when the listed item (or its absence) shows the action happened; all unanswered when it could not be read. */
async function readByListing<Item extends { readonly id: string }>(action: InstantAction, read: () => Promise<readonly Item[] | undefined>, happened: (item: Item | undefined) => boolean): Promise<InstantAnswer> {
  const listed = await read().catch((): undefined => undefined);
  if (listed === undefined) return { doneIds: [], refused: [], unansweredIds: ids(action) };
  const byId = new Map(listed.map((item) => [item.id, item]));
  return { doneIds: ids(action).filter((id) => happened(byId.get(id))), refused: [], unansweredIds: [] };
}
