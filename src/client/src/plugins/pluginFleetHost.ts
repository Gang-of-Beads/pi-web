import type { Machine, SessionInfo } from "../api";
import type { RealtimeEvent, SessionUiEvent } from "../../../shared/apiTypes";
import type { FleetCoverage, FleetMachine, FleetMachineActionResult, FleetMachinesSnapshot, FleetOpenResult, FleetReachability, FleetSession, FleetSessionsSnapshot, PluginFleet, SessionFactScope, SessionRunAskedBy } from "../../../shared/pluginApiTypes";
import type { SessionBoardController } from "../controllers/sessionBoardController";
import type { MachineReachability, MachineReachabilityView } from "../machineReachability";
import { machineSessionKey } from "../machineKeys";
import { sessionLabel } from "../sessionLabels";
import { sessionLocationVerdict } from "../sessionLocationVerdict";
import type { BoardAnswer, SessionBoard } from "../sync/sessionBoard";
import type { ReadFact } from "../sync/readPhase";
import { deepFrozen, type PluginFactBus } from "./pluginFacts";
import type { RunStartTranscript } from "./runAskedBy";
import { SessionRunWatch } from "./sessionRunFacts";

/** The roster as the app holds it. */
export interface FleetRoster {
  readonly loaded: boolean;
  readonly machines: readonly Machine[];
  readonly selectedMachineId: string;
}

/** The host's own machine dialogs and checks, each acting on the machine it is handed. */
export interface FleetMachineManagement {
  /** Open the add-machine dialog; false when no plugin provides one. */
  addMachine(): boolean;
  renameMachine(machine: Machine): void;
  removeMachine(machine: Machine): void;
  openMachine(machine: Machine): void;
  refreshMachine(machine: Machine): void;
}

export interface PluginFleetHostDependencies {
  roster(): FleetRoster;
  /** What the page's running check confirmed about the machine; a remembered state, or any state while the checks are paused, reads as checking. */
  reachability(machine: Machine): MachineReachabilityView;
  /** Keep every machine's reachability checked while an owner wants it. */
  watchReachability(owner: object, wanted: boolean): void;
  boards: Pick<SessionBoardController, "liveBoard" | "known" | "answer" | "readState" | "watch" | "read">;
  /** Where a session no board lists is: the session, gone, or a throw when the machine did not answer. */
  locateSession(machineId: string, sessionId: string): Promise<SessionInfo | "gone">;
  /** The host's navigation to a session (the quick switcher's path). */
  openSession(machineId: string, session: SessionInfo): Promise<FleetOpenResult>;
  /** Begin waiting on the reader's behalf: true while no other navigation has begun since. */
  navigationIntent(): () => boolean;
  /** Whether the page holds this session's own stream (it is the session on screen). */
  holdsStream(machineId: string, sessionId: string): boolean;
  /** What the session's transcript on screen holds as a run starts; see runAskedBy. */
  runStartTranscript(machineId: string, sessionId: string): RunStartTranscript;
  /** Which device sent the newest user message a run that just ended took; `atStart` is undefined when the page did not see the run start. See runAskedBy. */
  askedBy(machineId: string, sessionId: string, atStart: RunStartTranscript | undefined): SessionRunAskedBy;
  management: FleetMachineManagement;
  facts: Pick<PluginFactBus, "emit">;
}

const FLEET_REACHABILITY: Readonly<Record<MachineReachability, FleetReachability>> = {
  checking: "checking",
  trying: "checking",
  online: "online",
  error: "daemonDown",
  offline: "offline",
  unknown: "unknown",
};

const REACHABILITY_WITH_REASON: ReadonlySet<FleetReachability> = new Set(["daemonDown", "offline", "unknown"]);

const REFUSAL_WORDS: Readonly<Record<Exclude<ReadFact["kind"], "none">, string>> = {
  "signed-out": "PI WEB asked you to sign in before it lists this machine's sessions.",
  forbidden: "PI WEB refused to list this machine's sessions.",
  gone: "PI WEB answered that this machine's session list was not found.",
};

const NOT_LISTED_WORDS = "This machine is not in the machine list.";

/** How long `openSession` waits for the machine list to first load before it answers `machinesUnloaded`. */
const ROSTER_WAIT_MS = 10_000;

/** How much of a board answered, for a plugin (`FleetCoverage`): a refusal ends it, an answer says how much, and otherwise whether anyone asked. */
function fleetCoverage(read: { readonly asked: boolean; readonly fact: ReadFact["kind"] }, answer: BoardAnswer): FleetCoverage {
  if (read.fact !== "none") return "failed";
  if (answer !== "none") return answer;
  return read.asked ? "loading" : "unloaded";
}

interface WatchedBoard {
  readonly listeners: Set<(snapshot: FleetSessionsSnapshot) => void>;
  release: (() => void) | undefined;
  inputs: readonly unknown[] | undefined;
  snapshot: FleetSessionsSnapshot | undefined;
}

/**
 * The fleet the browser plugins read (issue #57, design 4.A), and the session and machine facts
 * (design 4.B) the page can tell from what it already receives. It owns nothing of its own: the
 * machines are the app's roster, their reachability the Machines list's checks, each board the
 * one Navigate reads, and opening a session the quick switcher's path. The app tells it whenever
 * any of those may have changed (`changed`), and it tells only the listeners whose snapshot did.
 */
export class PluginFleetHost {
  private readonly machineListeners = new Set<(snapshot: FleetMachinesSnapshot) => void>();
  private readonly boards = new Map<string, WatchedBoard>();
  private machinesSnapshot: FleetMachinesSnapshot = deepFrozen({ loaded: false, machines: [] });
  /** Opens waiting for the machine list to first load. */
  private readonly rosterWaiters = new Set<() => void>();
  private readonly answeredReachability = new Map<string, FleetReachability>();
  private readonly runs: SessionRunWatch;
  /** The checks' owner for reachability fact listeners, apart from the fleet machines listeners'. */
  private readonly reachabilityListening = {};
  /** Per session (`machineSessionKey`), the transcript as each run the page saw start began. */
  private readonly runStarts = new Map<string, RunStartTranscript>();

  constructor(private readonly deps: PluginFleetHostDependencies) {
    this.runs = new SessionRunWatch({
      started: (machineId, sessionId) => {
        this.runStarts.set(machineSessionKey(machineId, sessionId), deps.runStartTranscript(machineId, sessionId));
        deps.facts.emit("session.run-started", { session: this.sessionScope(machineId, sessionId) });
        this.changed();
      },
      ended: (machineId, sessionId, outcome) => {
        const key = machineSessionKey(machineId, sessionId);
        const atStart = this.runStarts.get(key);
        this.runStarts.delete(key);
        deps.facts.emit("session.run-ended", { session: this.sessionScope(machineId, sessionId), outcome, askedBy: deps.askedBy(machineId, sessionId, atStart) });
        this.changed();
      },
    }, (machineId, sessionId) => deps.holdsStream(machineId, sessionId));
  }

  /** One plugin's fleet; `dispose` drops every subscription it made. */
  open(): { readonly fleet: PluginFleet; readonly dispose: () => void } {
    const disposers = new Set<() => void>();
    const held = (unsubscribe: () => void): (() => void) => {
      const once = () => {
        if (!disposers.delete(once)) return;
        unsubscribe();
      };
      disposers.add(once);
      return once;
    };
    const fleet: PluginFleet = Object.freeze({
      machines: () => this.machinesSnapshot,
      onDidChangeMachines: (listener: (snapshot: FleetMachinesSnapshot) => void) => held(this.subscribeMachines(listener)),
      sessions: (machineId: string) => this.sessionsSnapshot(machineId),
      onDidChangeSessions: (machineId: string, listener: (snapshot: FleetSessionsSnapshot) => void) => held(this.subscribeSessions(machineId, listener)),
      refreshSessions: (machineId: string, signal?: AbortSignal) => this.refreshSessions(machineId, signal),
      openSession: (target: { readonly machineId: string; readonly sessionId: string }) => this.openSession(target.machineId, target.sessionId),
      addMachine: () => (this.deps.management.addMachine() ? "started" : "unsupported"),
      renameMachine: (machineId: string) => this.onListed(machineId, (machine) => this.started(() => { this.deps.management.renameMachine(machine); })),
      removeMachine: (machineId: string) => this.onListed(machineId, (machine) => (machine.kind === "local" ? "unsupported" : this.started(() => { this.deps.management.removeMachine(machine); }))),
      openMachine: (machineId: string) => this.onListed(machineId, (machine) => (machine.kind === "remote" && machine.baseUrl !== undefined ? this.started(() => { this.deps.management.openMachine(machine); }) : "unsupported")),
      refreshMachine: (machineId: string) => this.onListed(machineId, (machine) => this.started(() => { this.deps.management.refreshMachine(machine); })),
    });
    return { fleet, dispose: () => { for (const dispose of [...disposers]) dispose(); } };
  }

  /**
   * Keep the reachability checks running while a plugin listens to reachability facts (owner
   * decision): the fact is a diff of the checks, so without them it would stay silent. One read
   * per machine per check interval, the Machines list's cadence.
   */
  watchReachability(wanted: boolean): void {
    this.deps.watchReachability(this.reachabilityListening, wanted);
  }

  /**
   * One listed machine as the fleet describes it now, read from the roster rather than the last
   * snapshot: a list drawn before the snapshot refreshes then describes the machine it draws.
   */
  listedMachine(machineId: string): FleetMachine | undefined {
    const roster = this.deps.roster();
    const machine = roster.machines.find((candidate) => candidate.id === machineId);
    return machine === undefined ? undefined : deepFrozen(this.fleetMachine(machine, roster.selectedMachineId));
  }

  /** Something the fleet is made of may have changed: tell the listeners whose snapshot did. */
  changed(): void {
    if (this.deps.roster().loaded) this.releaseRosterWaiters();
    this.refreshMachines();
    for (const [machineId, watched] of this.boards) this.refreshBoard(machineId, watched);
  }

  /** A frame of a machine's announcements. */
  machineFrame(machineId: string, event: RealtimeEvent): void {
    this.runs.machineFrame(machineId, event);
    if (event.type === "session.created") this.deps.facts.emit("session.created", { session: this.sessionScope(machineId, event.session.id, event.session.cwd) });
    else if (event.type === "session.name") this.deps.facts.emit("session.renamed", { session: this.sessionScope(machineId, event.sessionId), name: event.name });
  }

  /** A frame of the session on screen's own stream. */
  streamFrame(machineId: string, sessionId: string, event: SessionUiEvent): void {
    this.runs.streamFrame(machineId, sessionId, event);
    if (event.type === "session.replaced") {
      this.deps.facts.emit("session.replaced", { from: this.sessionScope(machineId, event.sessionId), to: this.sessionScope(machineId, event.session.id, event.session.cwd), reason: "new" });
    }
  }

  /** The page stopped hearing a session's own stream: its open run cannot be known to have completed. */
  streamLost(machineId: string, sessionId: string): void {
    this.runs.streamLost(machineId, sessionId);
  }

  /** Statuses the page read for a machine's sessions. */
  knownStatuses(machineId: string, statuses: Iterable<{ readonly sessionId: string; readonly isStreaming: boolean }>): void {
    this.runs.knownStatuses(machineId, statuses);
  }

  /** The page may have missed what a machine announced. */
  forgetMachine(machineId: string): void {
    this.runs.forgetMachine(machineId);
  }

  private started(act: () => void): FleetMachineActionResult {
    act();
    return "started";
  }

  /** A management call decides from the loaded machine list only: before it loads, nothing is known about the machine. */
  private onListed(machineId: string, act: (machine: Machine) => FleetMachineActionResult): FleetMachineActionResult {
    const roster = this.deps.roster();
    if (!roster.loaded) return "machinesUnloaded";
    const machine = roster.machines.find((candidate) => candidate.id === machineId);
    return machine === undefined ? "machineUnknown" : act(machine);
  }

  /** Whether the machine list has loaded, waiting for its first load up to `ROSTER_WAIT_MS`. */
  private untilRosterLoaded(): Promise<boolean> {
    if (this.deps.roster().loaded) return Promise.resolve(true);
    return new Promise((resolve) => {
      const loaded = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.rosterWaiters.delete(loaded);
        resolve(false);
      }, ROSTER_WAIT_MS);
      this.rosterWaiters.add(loaded);
    });
  }

  private releaseRosterWaiters(): void {
    const waiters = [...this.rosterWaiters];
    this.rosterWaiters.clear();
    for (const loaded of waiters) loaded();
  }

  private subscribeMachines(listener: (snapshot: FleetMachinesSnapshot) => void): () => void {
    this.machineListeners.add(listener);
    if (this.machineListeners.size === 1) this.deps.watchReachability(this, true);
    return () => {
      if (!this.machineListeners.delete(listener)) return;
      if (this.machineListeners.size === 0) this.deps.watchReachability(this, false);
    };
  }

  private subscribeSessions(machineId: string, listener: (snapshot: FleetSessionsSnapshot) => void): () => void {
    const watched = this.boards.get(machineId) ?? { listeners: new Set(), release: undefined, inputs: undefined, snapshot: undefined };
    this.boards.set(machineId, watched);
    watched.listeners.add(listener);
    this.refreshBoard(machineId, watched);
    return () => {
      if (!watched.listeners.delete(listener) || watched.listeners.size > 0) return;
      watched.release?.();
      this.boards.delete(machineId);
    };
  }

  private listed(machineId: string): boolean {
    return this.deps.roster().machines.some((machine) => machine.id === machineId);
  }

  private async refreshSessions(machineId: string, signal: AbortSignal | undefined): Promise<void> {
    signal?.throwIfAborted();
    if (!this.listed(machineId)) return;
    const release = this.deps.boards.watch(machineId);
    try {
      await untilAborted(this.deps.boards.read(machineId, { force: true }), signal);
    } finally {
      release();
    }
  }

  /**
   * Open a session the plugin names by machine and id. The session is the one that machine's board
   * lists, or else the one the machine locates; a machine no longer listed, or a reader who moved on
   * while the machine list loaded or the session was located, opens nothing. "Not listed" is
   * decided only from a loaded machine list.
   */
  private async openSession(machineId: string, sessionId: string): Promise<FleetOpenResult> {
    const current = this.deps.navigationIntent();
    if (!(await this.untilRosterLoaded())) return "machinesUnloaded";
    if (!current()) return "superseded";
    if (!this.listed(machineId)) return "machineUnknown";
    const known = this.deps.boards.known(machineId);
    let session = [...(known?.sessions ?? []), ...(known?.pinnedElsewhere ?? [])].find((candidate) => candidate.id === sessionId);
    if (session === undefined) {
      try {
        const located = await this.deps.locateSession(machineId, sessionId);
        if (located === "gone") return "sessionGone";
        session = located;
      } catch {
        return this.listed(machineId) ? "machineUnreachable" : "machineUnknown";
      }
      if (!current()) return "superseded";
    }
    return this.deps.openSession(machineId, session);
  }

  private refreshMachines(): void {
    const roster = this.deps.roster();
    const next: FleetMachinesSnapshot = {
      loaded: roster.loaded,
      machines: roster.machines.map((machine) => this.fleetMachine(machine, roster.selectedMachineId)),
    };
    const previous = this.machinesSnapshot;
    if (JSON.stringify(previous) === JSON.stringify(next)) return;
    this.machinesSnapshot = deepFrozen(next);
    this.announceMachineChanges(previous, next);
    notifyAll(this.machineListeners, this.machinesSnapshot, "fleet machines");
  }

  private fleetMachine(machine: Machine, selectedMachineId: string): FleetMachine {
    const view = this.deps.reachability(machine);
    const reachability = FLEET_REACHABILITY[view.state];
    return {
      id: machine.id,
      name: machine.name,
      kind: machine.kind,
      selected: machine.id === selectedMachineId,
      reachability,
      ...(REACHABILITY_WITH_REASON.has(reachability) && view.text !== "" ? { reason: view.text } : {}),
    };
  }

  /** Machines added after the list first loaded, machines removed, and each machine whose answered reachability changed. */
  private announceMachineChanges(previous: FleetMachinesSnapshot, next: FleetMachinesSnapshot): void {
    if (!next.loaded) return;
    const before = new Map(previous.machines.map((machine) => [machine.id, machine]));
    const after = new Set(next.machines.map((machine) => machine.id));
    for (const machine of next.machines) {
      if (previous.loaded && !before.has(machine.id)) this.deps.facts.emit("machine.added", { machine });
      if (machine.reachability === "checking") continue;
      const answered = this.answeredReachability.get(machine.id);
      this.answeredReachability.set(machine.id, machine.reachability);
      if (answered !== undefined && answered !== machine.reachability) this.deps.facts.emit("machine.reachability-changed", { machine, previous: answered });
    }
    for (const machine of previous.machines) {
      if (after.has(machine.id)) continue;
      this.answeredReachability.delete(machine.id);
      this.runs.forgetMachine(machine.id);
      if (previous.loaded) this.deps.facts.emit("machine.removed", { machineId: machine.id, name: machine.name });
    }
  }

  /** Hold the board read while the machine is listed, and tell its listeners when its snapshot changed since the one they could read when they subscribed. */
  private refreshBoard(machineId: string, watched: WatchedBoard): void {
    const listed = this.listed(machineId);
    if (listed && watched.release === undefined) {
      watched.release = this.deps.boards.watch(machineId);
      void this.deps.boards.read(machineId);
    } else if (!listed && watched.release !== undefined) {
      watched.release();
      watched.release = undefined;
    }
    const read = this.deps.boards.readState(machineId);
    const inputs = [listed, this.deps.roster().loaded, this.deps.boards.known(machineId), this.deps.boards.answer(machineId), read.fact, read.asked, this.runs.revision];
    if (watched.inputs !== undefined && inputs.every((input, index) => input === watched.inputs?.[index])) return;
    watched.inputs = inputs;
    const snapshot = this.sessionsSnapshot(machineId);
    const baseline = watched.snapshot === undefined;
    if (!baseline && JSON.stringify(watched.snapshot) === JSON.stringify(snapshot)) return;
    watched.snapshot = snapshot;
    if (!baseline) notifyAll(watched.listeners, snapshot, `fleet sessions of ${machineId}`);
  }

  /**
   * One machine's board for a plugin. Rows come from what answered: a `partial` board's rows include
   * those this browser remembers for the listings that did not answer (`remembered`), and a
   * refusal keeps the last rows the page held, with the refusal's words.
   */
  private sessionsSnapshot(machineId: string): FleetSessionsSnapshot {
    const roster = this.deps.roster();
    if (roster.loaded && !this.listed(machineId)) return deepFrozen({ machineId, coverage: "failed", sessions: [], error: NOT_LISTED_WORDS });
    const read = this.deps.boards.readState(machineId);
    const answer = this.deps.boards.answer(machineId);
    const coverage = fleetCoverage(read, answer);
    const board = answer === "none" ? undefined : this.deps.boards.liveBoard(machineId);
    const answered = new Set(boardSessions(this.deps.boards.known(machineId)).map((session) => session.id));
    const sessions = board === undefined ? [] : boardSessions(board).map((session) => this.fleetSession(machineId, board, session, !answered.has(session.id)));
    return deepFrozen({ machineId, coverage, sessions, ...(read.fact === "none" ? {} : { error: REFUSAL_WORDS[read.fact] }) });
  }

  private fleetSession(machineId: string, board: SessionBoard, session: SessionInfo, remembered: boolean): FleetSession {
    const streaming = this.runs.running(machineId, session.id);
    return {
      machineId,
      sessionId: session.id,
      cwd: session.cwd,
      title: sessionLabel(session),
      updatedAt: session.modified,
      ...placement(board, session.cwd),
      ...(streaming === undefined ? {} : { streaming }),
      ...(session.archived === true ? { archived: true } : {}),
      ...(remembered ? { remembered: true } : {}),
    };
  }

  /** A session's scope as far as the page knows it: its folder from the fact or the board, and the workspace that holds it. */
  private sessionScope(machineId: string, sessionId: string, cwd?: string): SessionFactScope {
    const board = this.deps.boards.known(machineId);
    const folder = cwd ?? (board === undefined ? undefined : boardSessions(board).find((session) => session.id === sessionId)?.cwd);
    return {
      machineId,
      sessionId,
      ...(folder === undefined ? {} : { cwd: folder }),
      ...(folder === undefined || board === undefined ? {} : placement(board, folder)),
    };
  }
}

function boardSessions(board: SessionBoard | undefined): readonly SessionInfo[] {
  if (board === undefined) return [];
  const listed = new Set(board.sessions.map((session) => session.id));
  return [...board.sessions, ...(board.pinnedElsewhere ?? []).filter((session) => !listed.has(session.id))];
}

/** The deepest workspace the board lists whose folder holds `cwd`. */
function placement(board: SessionBoard, cwd: string): { projectId?: string; workspaceId?: string } {
  const holding = board.workspaces
    .filter((workspace) => sessionLocationVerdict(cwd, workspace.path) === "described")
    .sort((left, right) => right.path.length - left.path.length)[0];
  return holding === undefined ? {} : { projectId: holding.projectId, workspaceId: holding.id };
}

function notifyAll<T>(listeners: ReadonlySet<(value: T) => void>, value: T, label: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(value);
    } catch (error) {
      console.error(`A plugin's ${label} listener failed`, error);
    }
  }
}

/** The read, or the signal's reason once it aborts; the read itself goes on for its other readers. */
async function untilAborted(read: Promise<void>, signal: AbortSignal | undefined): Promise<void> {
  if (signal === undefined) {
    await read;
    return;
  }
  let stop: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    stop = () => { reject(abortError(signal)); };
    signal.addEventListener("abort", stop, { once: true });
  });
  try {
    await Promise.race([read, aborted]);
  } finally {
    if (stop !== undefined) signal.removeEventListener("abort", stop);
  }
}

/** The signal's reason, which an abort sets to an Error unless the caller gave another value. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error("The read was aborted.", { cause: reason });
}
