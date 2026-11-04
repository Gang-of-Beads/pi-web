import { stat } from "node:fs/promises";
import { basename, dirname, join, resolve, sep } from "node:path";
import {
  folderNameProblem,
  projectRenameNameWords,
  type ProjectRenameBlocker,
  type ProjectRenameNameCheck,
  type ProjectRenamePreview,
  type ProjectRenameResult,
} from "../../../shared/projectRenameProtocol.js";
import type { WorkspaceProviderAuthorityResolution, WorkspaceProviderDiagnosticCode } from "../../../shared/apiTypes.js";
import { errorMessage } from "../../../shared/unknownValues.js";
import type { Project } from "../../shared/types.js";
import type { FolderHolds } from "../folderHolds.js";
import type { SessionArchiveStore } from "../sessions/sessionArchiveStore.js";
import { readSessionHeader, type SessionHeaderSummary } from "../sessions/sessionFileHeader.js";
import type { SessionInsideFolder, SessionInsideFolderActivity } from "../sessions/piSessionService.js";
import type { TerminalInfo } from "../terminals/terminalService.js";
import { canonicalizeStoredCwd, cwdPathsEqual, folderKey, insideFolder } from "../workingDirectory.js";
import { movedPath, type FolderMove } from "./folderMove.js";
import { freeFor, identityOf, isAbsentPathError, samePath } from "./pathFacts.js";
import { clearRenameJournal, readRenameJournal, RENAME_STEPS, writeRenameJournal, type ProjectChange, type RenameJournal } from "./renameJournal.js";
import { headerFilePlaces, RENAME_STEP_EXECUTORS, undoStartedSteps, type PutBackOutcome, type RenameStepPorts } from "./renameSteps.js";
import { planSessionStore, type HeaderRewrite, type MovedSession } from "./sessionStorePlan.js";
import { planTrustMoves } from "./trustMove.js";

/** What the rename needs from the session service: what is open in the folder, and the state it keeps per session. */
export interface ProjectRenameSessions {
  sessionsInside(folder: string): Promise<readonly SessionInsideFolder[]>;
  closeIdleInside(folder: string): Promise<void>;
  sessionFilesOpenOutside(folder: string): Set<string>;
  sessionFilesOpen(): Set<string>;
  relocateSessions(moves: readonly MovedSession[]): Promise<void>;
  forgetSessionFiles(files: readonly string[]): void;
}

export interface ProjectRenameProjects {
  list(): Promise<Project[]>;
  get(id: string): Promise<Project | undefined>;
  relocate(changes: readonly ProjectChange[]): Promise<void>;
}

export interface ProjectRenameSessionDirs {
  defaultSessionsRoot(): string;
  globalEnvSessionDir(): string | undefined;
  resolve(cwd: string): { sessionDir: string; usesConfiguredSessionDir: boolean };
}

export interface ProjectRenameLogger {
  warn(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface ProjectRenameServiceOptions {
  readonly agentDir: string;
  readonly journalPath: string;
  /** The daemon's run records (in flight, interrupted), which name each session's folder. */
  readonly runFiles: readonly string[];
  readonly sessionDirs: ProjectRenameSessionDirs;
  readonly archive: Pick<SessionArchiveStore, "list" | "relocate">;
  readonly sessions: ProjectRenameSessions;
  readonly terminals: { inside(folder: string): readonly TerminalInfo[] };
  readonly projects: ProjectRenameProjects;
  readonly providers: RenameStepPorts["providers"];
  /** The project's workspaces: a repository's linked worktrees can live outside its folder. */
  readonly workspaces: { resolve(project: Project): Promise<WorkspaceProviderAuthorityResolution> };
  readonly holds: FolderHolds;
  /** Folders PI WEB and Pi keep their own files in, or run from: none may be inside a renamed folder. */
  readonly protectedFolders: readonly string[];
  readonly windows: boolean;
  readonly logger: ProjectRenameLogger;
  /** The projects and their workspaces changed: whatever caches them must read them again. */
  readonly onRenamed: () => void;
  /** How long a put-back that failed waits before it is tried again. */
  readonly retryPutBackMs?: number;
}

export type ProjectRenameRefusalKind = "not-found" | "name" | "blocked";

const REFUSAL_STATUS: Readonly<Record<ProjectRenameRefusalKind, number>> = { "not-found": 404, name: 400, blocked: 409 };

/** A rename that did not start: nothing moved, and the message says why. */
export class ProjectRenameRefusal extends Error {
  override name = "ProjectRenameRefusal";
  readonly statusCode: number;

  constructor(readonly kind: ProjectRenameRefusalKind, message: string) {
    super(message);
    this.statusCode = REFUSAL_STATUS[kind];
  }
}

/** A rename that started and failed: everything was put back, or the message says what was not. */
export class ProjectRenameFailure extends Error {
  override name = "ProjectRenameFailure";
}

const BLOCKER_FOR: Readonly<Record<Exclude<SessionInsideFolderActivity, "idle">, (label: string) => ProjectRenameBlocker>> = {
  working: (label) => ({ kind: "session-working", label: `\u201c${label}\u201d is working` }),
  background: (label) => ({ kind: "background-work", label: `\u201c${label}\u201d has background work running` }),
  unchecked: (label) => ({ kind: "background-unchecked", label: `\u201c${label}\u201d may have background work running: it could not be checked` }),
  opening: () => ({ kind: "session-opening", label: "A session is opening" }),
};

const HELD_REASON = "This folder is being renamed. Try again in a moment.";
const HELD_FILE_REASON = "A project rename is rewriting this session's file. Try again in a moment.";
const HELD_PROJECT_REASON = "The project this folder belongs to is being renamed. Try again in a moment.";

/** One try at putting a journal back: tried, with what it came to, or not tried while sessions write where it would move or write. */
type HeldPutBack = { readonly kind: "tried"; readonly outcome: PutBackOutcome } | { readonly kind: "waiting"; readonly reason: string };
/** How many errors a message names before it counts the rest. */
const ERRORS_NAMED = 3;
const RETRY_PUT_BACK_MS = 60_000;

/**
 * A rename that failed and was not put back completely. Until it is, no other rename starts: its
 * journal is the only record of what to put back, and a second rename would write over it.
 */
type Unfinished =
  | { readonly kind: "retrying"; readonly reason: string }
  | { readonly kind: "unreadable"; readonly reason: string };

const UNFINISHED_BLOCKER: Readonly<Record<Unfinished["kind"], (reason: string) => ProjectRenameBlocker>> = {
  retrying: (reason) => ({ kind: "rename-unfinished", label: `An earlier rename on this machine failed and is not completely put back yet (${reason}); the session daemon keeps trying` }),
  unreadable: (reason) => ({ kind: "rename-record-unreadable", label: reason }),
};

/**
 * Rename a project by renaming its folder (owner, 2026-11-04), and carry along everything that
 * names the folder: Pi's session store and session headers, the daemon's records of those
 * sessions, Pi's trust decisions, the providers' own links (Git worktrees), and the project list.
 *
 * Nothing may be working in the folder: a session turn, a background run or an open shell would
 * go on writing at the old path. While the rename runs, no session or shell may start inside the
 * folder (FolderHolds). Each step is written to a journal before it starts, and any failure puts
 * back every started step, newest first, the folder name included (owner, 2026-11-04); a daemon
 * stopped halfway puts them back when it next starts (`recover`), and a put-back that fails is
 * tried again until it succeeds, renames waiting meanwhile.
 */
export class ProjectRenameService {
  private running: Promise<unknown> | undefined;
  private unfinished: Unfinished | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private readonly ports: RenameStepPorts;

  constructor(private readonly options: ProjectRenameServiceOptions) {
    this.ports = {
      agentDir: options.agentDir,
      runFiles: options.runFiles,
      archive: options.archive,
      sessions: options.sessions,
      providers: options.providers,
      projects: options.projects,
    };
  }

  async preview(projectId: string, name: string | undefined): Promise<ProjectRenamePreview> {
    const project = await this.requireProject(projectId);
    const from = canonicalizeStoredCwd(project.path);
    const blockers = await this.blockers(project, this.machineBlockers());
    const check = name === undefined ? undefined : await this.nameCheck(name, from, project);
    return {
      parentPath: withTrailingSeparator(dirname(from)),
      folderName: basename(from),
      blockers,
      ...(check === undefined ? {} : { name: check }),
    };
  }

  async rename(projectId: string, name: string): Promise<ProjectRenameResult> {
    if (this.closed) throw new ProjectRenameRefusal("blocked", "The session daemon is stopping; rename once it is back.");
    const [busy] = this.machineBlockers();
    if (busy !== undefined) throw new ProjectRenameRefusal("blocked", `${busy.label}.`);
    const running = this.renameNow(projectId, name);
    this.running = running;
    try {
      return await running;
    } finally {
      this.running = undefined;
    }
  }

  /** Put back a rename a stopped daemon left unfinished; called once at startup, before anything is served. */
  async recover(): Promise<void> {
    await this.putBackUnfinished().catch((error: unknown) => { this.putBackFailed(error); });
  }

  /**
   * The daemon is stopping: refuse new renames, stop trying put-backs again, and wait for a rename
   * or put-back in progress to end before the stores and plugins it writes through stop.
   */
  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.running?.catch(() => undefined);
  }

  private async putBackUnfinished(): Promise<void> {
    let journal: RenameJournal | undefined;
    try {
      journal = await readRenameJournal(this.options.journalPath);
    } catch (error) {
      const reason = `The record of an earlier rename, ${this.options.journalPath}, cannot be read, so nothing of it was put back (${errorMessage(error)}); check that rename's folder, then remove the record`;
      if (this.unfinished?.reason !== reason) this.options.logger.error({ err: error, journal: this.options.journalPath }, "an unfinished project rename cannot be read; nothing was put back");
      this.unfinished = { kind: "unreadable", reason };
      this.retryLater();
      return;
    }
    if (journal === undefined) {
      this.unfinished = undefined;
      return;
    }
    if (await this.committed(journal)) {
      await clearRenameJournal(this.options.journalPath);
      this.unfinished = undefined;
      return;
    }
    const held = await this.putBackHeld(journal);
    if (held.kind === "waiting") {
      if (this.unfinished?.reason !== held.reason) this.options.logger.warn({ move: journal.move, reason: held.reason }, "putting back an unfinished project rename waits for sessions to close");
      this.unfinished = { kind: "retrying", reason: held.reason };
      this.retryLater();
      return;
    }
    const { failures, unrestorable } = held.outcome;
    if (unrestorable.length > 0) this.options.logger.warn({ unrestorable: unrestorable.map(errorMessage), move: journal.move }, "part of an unfinished project rename cannot be put back");
    if (failures.length > 0) {
      if (this.stillUnfinished(failures)) {
        this.options.logger.error({ failures: failures.map(errorMessage), move: journal.move }, "putting back an unfinished project rename failed; it is tried again");
      }
      return;
    }
    await clearRenameJournal(this.options.journalPath);
    this.unfinished = undefined;
    this.options.onRenamed();
    this.options.logger.warn({ move: journal.move }, "put back a project rename that had not finished");
  }

  /**
   * Put a journal back while nothing can start in either folder or on a file it rewrites, as the
   * rename itself held them. It waits, putting nothing back, while a session is open in the folder
   * under its new name, or on a session file the put-back would move (one still where the plan
   * moved it) or write (one whose header still holds the moved paths): moving or replacing a file a
   * session writes would lose what it wrote.
   */
  private async putBackHeld(journal: RenameJournal): Promise<HeldPutBack> {
    const places = journal.rewrites.flatMap((rewrite) => headerFilePlaces(rewrite, journal).map((file, index, all) => ({ rewrite, file: resolve(file), movesBack: index === 0 && all.length > 1 })));
    const releaseFolders = this.options.holds.hold([journal.move.from, journal.move.to], HELD_REASON);
    const releaseFiles = this.options.holds.hold([], HELD_FILE_REASON, places.map(({ file }) => file));
    try {
      const open = new Set([...this.options.sessions.sessionFilesOpen()].map((file) => resolve(file)));
      for (const { rewrite, file, movesBack } of places) {
        if (open.has(file) && (movesBack || await stillRewritten(rewrite, file))) return { kind: "waiting", reason: `it waits for the session open on ${file} to close` };
      }
      if ((await this.options.sessions.sessionsInside(journal.move.to)).length > 0) return { kind: "waiting", reason: `it waits for the sessions open in ${journal.move.to} to close` };
      return { kind: "tried", outcome: await undoStartedSteps(journal, this.ports) };
    } finally {
      releaseFiles();
      releaseFolders();
    }
  }

  /** A put-back that could not even be tried through, such as a journal that cannot be removed. */
  private putBackFailed(error: unknown): void {
    if (this.stillUnfinished([error])) this.options.logger.error({ err: error }, "putting back an unfinished project rename failed; it is tried again");
  }

  /** Record a put-back that failed, and try it again later; answers whether its reason is new. */
  private stillUnfinished(failures: readonly unknown[]): boolean {
    const reason = namedErrors(failures);
    const isNew = this.unfinished?.reason !== reason;
    this.unfinished = { kind: "retrying", reason };
    this.retryLater();
    return isNew;
  }

  private retryLater(): void {
    if (this.closed || this.retryTimer !== undefined) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.running !== undefined) {
        this.retryLater();
        return;
      }
      const retry = this.putBackUnfinished().catch((error: unknown) => { this.putBackFailed(error); });
      this.running = retry;
      void retry.finally(() => { if (this.running === retry) this.running = undefined; });
    }, this.options.retryPutBackMs ?? RETRY_PUT_BACK_MS);
    this.retryTimer.unref();
  }

  /**
   * Whether the rename got to its end: the project list is written last and in one replace, so a
   * journal whose last step started and whose list names the new folder is done, `committed` or not.
   */
  private async committed(journal: RenameJournal): Promise<boolean> {
    if (journal.committed === true) return true;
    if (journal.started !== "projects") return false;
    const renamed = journal.projects.find(({ id }) => id === journal.project.id);
    const listed = await this.options.projects.get(journal.project.id);
    return renamed !== undefined && listed !== undefined && cwdPathsEqual(listed.path, renamed.to.path);
  }

  private machineBlockers(): ProjectRenameBlocker[] {
    if (this.unfinished !== undefined) return [UNFINISHED_BLOCKER[this.unfinished.kind](this.unfinished.reason)];
    return this.running === undefined ? [] : [renameRunning()];
  }

  private async renameNow(projectId: string, rawName: string): Promise<ProjectRenameResult> {
    const project = await this.requireProject(projectId);
    const from = canonicalizeStoredCwd(project.path);
    const check = await this.nameCheck(rawName, from, project);
    if (check !== undefined) throw new ProjectRenameRefusal("name", check.message);
    const name = rawName.trim();
    const move: FolderMove = { from, to: join(dirname(from), name) };
    const { folders } = await this.workFolders(project, from);
    const releaseFolder = this.options.holds.hold([move.from, move.to], HELD_REASON);
    const releaseElsewhere = this.options.holds.hold(folders.filter((folder) => !insideFolder(folder, from)), HELD_PROJECT_REASON);
    try {
      await this.refuseWhileBlocked(project);
      await this.plan(project, move, name);
      for (const folder of folders) await this.options.sessions.closeIdleInside(folder);
      await this.refuseWhileBlocked(project);
      const planned = await this.plan(project, move, name);
      const releaseFiles = this.options.holds.hold([], HELD_FILE_REASON, planned.rewrites.map(({ file }) => file));
      try {
        await this.run(this.withoutFilesOpenedMeanwhile(planned));
      } finally {
        releaseFiles();
      }
      return { project: { ...project, name, path: move.to }, from: move.from, to: move.to };
    } finally {
      releaseElsewhere();
      releaseFolder();
    }
  }

  private async refuseWhileBlocked(project: Project): Promise<void> {
    const blockers = await this.blockers(project, []);
    if (blockers.length === 0) return;
    throw new ProjectRenameRefusal("blocked", `Stop these first to rename: ${blockers.map(({ label }) => label).join("; ")}.`);
  }

  /**
   * What the rename will change. Planned once before anything is closed, so a store it cannot move
   * is refused while the folder's sessions are still open, and again after, for what closing wrote.
   */
  private async plan(project: Project, move: FolderMove, name: string): Promise<RenameJournal> {
    const folder = await identityOf(move.from);
    if (folder === undefined) throw new ProjectRenameRefusal("blocked", "The project's folder is missing, so there is nothing to rename.");
    const [projects, archived] = await Promise.all([this.options.projects.list(), this.options.archive.list()]);
    const store = await planSessionStore({
      move,
      storeRoot: this.options.sessionDirs.defaultSessionsRoot(),
      configuredDirs: this.configuredSessionDirs(move.from),
      archived,
      openSessionFiles: this.options.sessions.sessionFilesOpenOutside(move.from),
    });
    if (store.kind === "unmovable") throw new ProjectRenameRefusal("blocked", `${store.reason}, so its sessions cannot follow the folder.`);
    const nested = projects
      .filter((candidate) => candidate.id !== project.id && insideFolder(candidate.path, move.from))
      .map((candidate): ProjectChange => ({
        id: candidate.id,
        from: { name: candidate.name, path: candidate.path },
        to: { name: candidate.name, path: movedPath(candidate.path, move) ?? candidate.path },
      }));
    return {
      version: 1,
      project: { id: project.id, name: project.name, path: project.path },
      move,
      folder,
      projects: [{ id: project.id, from: { name: project.name, path: project.path }, to: { name, path: move.to } }, ...nested],
      dirMoves: store.dirMoves,
      rewrites: store.rewrites,
      archived: store.archived,
      sessions: store.sessions,
      trust: await planTrustMoves(this.options.agentDir, move),
    };
  }

  /** A session opened outside the folder after the plan, before its file was held, keeps its parent link: its file is being written. */
  private withoutFilesOpenedMeanwhile(journal: RenameJournal): RenameJournal {
    const open = this.options.sessions.sessionFilesOpenOutside(journal.move.from);
    return open.size === 0 ? journal : { ...journal, rewrites: journal.rewrites.filter(({ file }) => !open.has(file)) };
  }

  private async run(planned: RenameJournal): Promise<void> {
    let journal = planned;
    try {
      for (const step of RENAME_STEPS) {
        journal = { ...journal, started: step };
        await writeRenameJournal(this.options.journalPath, journal);
        await RENAME_STEP_EXECUTORS[step].apply(journal, this.ports);
      }
    } catch (error) {
      throw await this.putBack(journal, error);
    }
    await writeRenameJournal(this.options.journalPath, { ...journal, committed: true }).catch(() => undefined);
    await clearRenameJournal(this.options.journalPath).catch((error: unknown) => {
      this.options.logger.warn({ err: error }, "a finished project rename left its journal behind");
    });
    this.options.sessions.forgetSessionFiles([...planned.dirMoves.map(({ from }) => from), ...planned.rewrites.map(({ file }) => file)]);
    this.options.onRenamed();
  }

  private async putBack(journal: RenameJournal, error: unknown): Promise<ProjectRenameFailure> {
    const { failures, unrestorable } = await undoStartedSteps(journal, this.ports);
    const reason = failureWords(journal, error);
    const cannot = unrestorable.length === 0 ? "" : ` Not put back, and not tried again: ${namedErrors(unrestorable)}.`;
    if (unrestorable.length > 0) this.options.logger.warn({ unrestorable: unrestorable.map(errorMessage), move: journal.move }, "part of a failed project rename cannot be put back");
    if (failures.length > 0) {
      this.stillUnfinished(failures);
      this.options.logger.error({ err: error, failures: failures.map(errorMessage), move: journal.move }, "a project rename failed and was not fully put back");
      return new ProjectRenameFailure(`Renaming failed (${reason}), and putting everything back failed too: ${namedErrors(failures)}. The session daemon keeps trying to put it back, and no other rename starts until it has.${cannot}`);
    }
    await clearRenameJournal(this.options.journalPath).catch(() => undefined);
    this.options.onRenamed();
    return new ProjectRenameFailure(unrestorable.length === 0 ? `Renaming failed, and everything was put back: ${reason}.` : `Renaming failed (${reason}), and the rest was put back.${cannot}`);
  }

  /**
   * What keeps the folder from moving now. Nothing may be working in the project, its workspaces
   * elsewhere included (owner, 2026-11-04): a repository keeps its linked worktrees' state inside
   * its folder, under `.git/worktrees`.
   */
  private async blockers(project: Project, extra: readonly ProjectRenameBlocker[]): Promise<ProjectRenameBlocker[]> {
    const from = canonicalizeStoredCwd(project.path);
    if (!await isDirectory(from)) return [...extra, { kind: "folder-missing", label: "The project's folder is missing, so there is nothing to rename" }];
    const blockers: ProjectRenameBlocker[] = [...extra];
    const guarded = this.options.protectedFolders.find((folder) => insideFolder(folder, from));
    if (guarded !== undefined) blockers.push({ kind: "protected-folder", label: `PI WEB or Pi keeps or runs its own files in ${guarded}; rename this folder outside PI WEB` });
    const { folders, unlisted } = await this.workFolders(project, from);
    if (unlisted !== undefined) blockers.push({ kind: "workspaces-unknown", label: `The project's workspaces could not be listed, so whether a session works in one is not known (${unlisted})` });
    const seen = new Set<string>();
    let terminals = 0;
    for (const folder of folders) {
      for (const session of await this.options.sessions.sessionsInside(folder)) {
        if (session.activity === "idle" || seen.has(session.sessionId)) continue;
        seen.add(session.sessionId);
        blockers.push(BLOCKER_FOR[session.activity](session.label));
      }
      terminals += this.options.terminals.inside(folder).length;
    }
    if (terminals > 0) blockers.push({ kind: "terminal-open", label: terminals === 1 ? "1 terminal is open" : `${String(terminals)} terminals are open` });
    return blockers;
  }

  /**
   * The project's folder, and the folders of the workspaces it and each project inside it have
   * outside it - a repository's linked worktrees elsewhere - leaving out a workspace the project is
   * itself inside. A listing that failed or came back degraded is said, not taken as complete.
   */
  private async workFolders(project: Project, from: string): Promise<{ folders: string[]; unlisted?: string }> {
    const nested = await this.nestedProjects(project, from);
    const elsewhere = new Set<string>();
    const problems: unknown[] = [];
    for (const each of [project, ...nested]) {
      let resolution: WorkspaceProviderAuthorityResolution;
      try {
        resolution = await this.options.workspaces.resolve(each);
      } catch (error) {
        problems.push(error);
        continue;
      }
      problems.push(...listingProblems(resolution));
      for (const { path } of resolution.workspaces) {
        const folder = canonicalizeStoredCwd(path);
        if (!insideFolder(folder, from) && !insideFolder(from, folder)) elsewhere.add(folder);
      }
    }
    return { folders: [from, ...elsewhere], ...(problems.length === 0 ? {} : { unlisted: namedErrors(problems) }) };
  }

  private async nameCheck(rawName: string, from: string, project: Project): Promise<ProjectRenameNameCheck | undefined> {
    const name = rawName.trim();
    const problem = folderNameProblem(rawName, basename(from), this.options.windows);
    if (problem !== undefined) return { problem, message: projectRenameNameWords(problem, name) };
    const to = join(dirname(from), name);
    const listed = (await this.options.projects.list()).some((candidate) => candidate.id !== project.id && folderKey(candidate.path) === folderKey(to));
    if (listed || !await freeFor(to, from)) return { problem: "taken", message: projectRenameNameWords("taken", name) };
    if (await samePath(to, from) && await this.hasWorktreeInside(project, from)) return { problem: "case-with-worktrees", message: projectRenameNameWords("case-with-worktrees", name) };
    return undefined;
  }

  /**
   * Whether the project, or a project inside its folder, may have a linked workspace inside the
   * folder. Git compares paths without regard to case on a disk that does, so a rename that only
   * changes the case leaves those workspaces recorded under the old spelling while PI WEB rewrites
   * their sessions' paths to the new one. A listing that failed may hide one, so it counts.
   */
  private async hasWorktreeInside(project: Project, from: string): Promise<boolean> {
    for (const each of [project, ...await this.nestedProjects(project, from)]) {
      let resolution: WorkspaceProviderAuthorityResolution;
      try {
        resolution = await this.options.workspaces.resolve(each);
      } catch {
        return true;
      }
      if (listingProblems(resolution).length > 0) return true;
      if (resolution.workspaces.some(({ path, isMain }) => !isMain && insideFolder(path, from))) return true;
    }
    return false;
  }

  private async nestedProjects(project: Project, from: string): Promise<Project[]> {
    return (await this.options.projects.list()).filter((candidate) => candidate.id !== project.id && insideFolder(candidate.path, from));
  }

  private configuredSessionDirs(folder: string): string[] {
    const dirs = new Set<string>();
    const env = this.options.sessionDirs.globalEnvSessionDir();
    if (env !== undefined) dirs.add(env);
    const resolved = this.options.sessionDirs.resolve(folder);
    if (resolved.usesConfiguredSessionDir) dirs.add(resolved.sessionDir);
    return [...dirs];
  }

  private async requireProject(projectId: string): Promise<Project> {
    const project = await this.options.projects.get(projectId);
    if (project === undefined) throw new ProjectRenameRefusal("not-found", "Project not found");
    return project;
  }
}

/** Which listing diagnostics mean the listing may be missing workspaces. */
const HIDES_WORKSPACES: Readonly<Record<WorkspaceProviderDiagnosticCode, boolean>> = { "probe-failed": true, "list-failed": true, "claim-conflict": true };

/** Why a workspace listing may be missing workspaces: a provider that could not be asked, or a listing that degraded to the folder alone. */
function listingProblems(resolution: WorkspaceProviderAuthorityResolution): string[] {
  const failed = resolution.diagnostics.filter(({ code }) => HIDES_WORKSPACES[code]).map(({ message }) => message);
  if (failed.length > 0) return failed;
  return resolution.status === "degraded" ? ["the workspace listing is degraded"] : [];
}

/** The first few errors' words, and how many more there are: a put-back of thousands of files must not fill the dialog. */
function namedErrors(errors: readonly unknown[]): string {
  const named = errors.slice(0, ERRORS_NAMED).map(errorMessage).join("; ");
  return errors.length > ERRORS_NAMED ? `${named}; and ${String(errors.length - ERRORS_NAMED)} more` : named;
}

/**
 * Whether a rewritten file's header still holds the moved paths, so putting it back would write
 * it. A header that cannot be read counts as one: could not look is not nothing to write.
 */
async function stillRewritten({ after }: HeaderRewrite, file: string): Promise<boolean> {
  let header: SessionHeaderSummary | undefined;
  try {
    header = await readSessionHeader(file);
  } catch {
    return true;
  }
  return header !== undefined && header.cwd === after.cwd && header.parentSession === after.parentSession;
}

function renameRunning(): ProjectRenameBlocker {
  return { kind: "rename-running", label: "A project is being renamed on this machine" };
}

function withTrailingSeparator(path: string): string {
  return path.endsWith(sep) ? path : `${path}${sep}`;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isAbsentPathError(error)) return false;
    throw error;
  }
}

const FOLDER_IN_USE = new Set(["EPERM", "EBUSY"]);

/** The reason a step failed, in the reader's words where the system's are a code. */
function failureWords(journal: RenameJournal, error: unknown): string {
  const code: unknown = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  if (journal.started === "folder" && typeof code === "string" && FOLDER_IN_USE.has(code)) {
    return `the folder could not be renamed (${code}): another program may be using it`;
  }
  return errorMessage(error);
}
