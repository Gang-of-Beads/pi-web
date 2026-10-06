import { api, type Machine, type MachineHealth, type MachineRuntime } from "../api";
import { resetWorkspaceScopedState, type AppState } from "../appState";
import { clearErrorPatch, errorNoticePatch, noticePatch } from "../errorNotice";
import { describeError, noticeForReader, noticeFromTransport } from "../notice";
import { classifyReadError, QUIET_WINDOW_MS, type ReadFact, type ReadMiss, type ReadOutcome } from "../sync/readPhase";
import { ScopedResource, type Unanswered } from "../sync/scopedResource";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import type { ProjectController } from "./projectController";

/** The roster has one key: the web process in use serves it. */
const ROSTER = "roster";

/**
 * What the next roster answer selects. A roster answer can land long after it
 * was asked for (a retry after a lost read, a remote machine's health read in
 * between), so it selects the machine the reader asked for only while they
 * still want it, and otherwise the machine they are on.
 */
interface MachinePreference {
  /** Undefined asks for the local machine. */
  readonly machineId: string | undefined;
  readonly wanted: () => boolean;
}

const ALWAYS = () => true;

/** Whether the reader asked for this read (Settings), or it runs in the background. */
type ReadAsker = "reader" | "background";

type NoticePatch = Pick<AppState, "error" | "errorRetiredBy" | "errorMachineId">;

/**
 * What a failed health or runtime read says (review 98e437b2). These are read
 * from the web process in use, which answers for a down remote with ok:false,
 * so a failed read is never evidence about the remote itself. The one
 * classifier the app row uses decides:
 * - nothing answered: the row speaks for it, unless the reader asked;
 * - the gateway said the remote did not answer: that machine, named;
 * - a server error or a refusal: its own words.
 */
const READ_FAILURE_NOTICE = new Map<Exclude<ReadMiss["kind"], "machine-unanswering"> | "fact", Readonly<Record<ReadAsker, "none" | "words">>>([
  ["fact", { reader: "words", background: "words" }],
  ["link-down", { reader: "words", background: "none" }],
  ["server-error", { reader: "words", background: "words" }],
]);

type ReadFailure = { readonly notice: "none" } | { readonly notice: "words" } | { readonly notice: "machine"; readonly machineId: string };

function readFailureNotice(outcome: ReadOutcome, asker: ReadAsker): ReadFailure {
  if (outcome.kind === "fact") return fromTable("fact", asker);
  const miss = outcome.miss;
  if (miss.kind === "machine-unanswering") return { notice: "machine", machineId: miss.machineId };
  return fromTable(miss.kind, asker);
}

function fromTable(key: Exclude<ReadMiss["kind"], "machine-unanswering"> | "fact", asker: ReadAsker): ReadFailure {
  return READ_FAILURE_NOTICE.get(key)?.[asker] === "none" ? { notice: "none" } : { notice: "words" };
}

/** The web process in use answered that this remote machine is down; an unknown health is not that answer. */
export function remoteReportedDown(health: MachineHealth | undefined): boolean {
  return health !== undefined && !health.ok && health.status !== "unknown";
}

/** A refusal the web process stated, in the reader's words (object model §0). */
const FACT_WORDS = new Map<ReadFact["kind"], string>([
  ["signed-out", "PI WEB asked you to sign in before it lists the machines."],
  ["forbidden", "PI WEB refused to list the machines."],
]);

export class MachineController {
  private readonly healthRefreshSeqByMachine = new Map<string, number>();
  private readonly runtimeRefreshSeqByMachine = new Map<string, number>();
  /**
   * The machines roster, read until answered (B48). A lost read keeps the
   * known roster, reports nothing, and is read again by itself; the app is
   * always its reader, so it is always watched.
   */
  private readonly roster: ScopedResource<typeof ROSTER, Machine[]>;
  private preference: MachinePreference = { machineId: undefined, wanted: ALWAYS };
  private mirrored: Machine[] | undefined;
  private applying: Promise<void> = Promise.resolve();
  private noticedFact: ReadFact["kind"] = "none";

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    private readonly updateUrl: UpdateUrl,
    private readonly projects: Pick<ProjectController, "loadProjects">,
  ) {
    this.roster = new ScopedResource<typeof ROSTER, Machine[]>({
      keyId: () => ROSTER,
      read: () => api.machines(),
      retryCapMs: QUIET_WINDOW_MS,
    });
    this.roster.watch(ROSTER);
    this.roster.subscribe(() => { this.mirror(); });
  }

  /**
   * Read the roster and select `routeMachineId` (the local machine when none
   * is named) once it answers, while `wanted` holds. Resolves after this
   * attempt settles; a lost attempt keeps being retried in the background, and
   * its answer is applied when it comes. Nothing here reports a lost read (B48).
   */
  async loadMachines(routeMachineId?: string, wanted: () => boolean = ALWAYS): Promise<void> {
    this.preference = { machineId: routeMachineId, wanted };
    if (!this.roster.entry(ROSTER).known) this.setState({ machinesLoad: "loading" });
    await this.roster.refresh(ROSTER);
    await this.applying;
  }

  /**
   * Wait until the roster has answered and been applied, for a reader that
   * cannot go on without it (a deep link to a remote machine). Resolves false
   * once the reader no longer wants it, or when the web process refused.
   */
  async rosterAnswered(wanted: () => boolean): Promise<boolean> {
    const view = await this.roster.whenAnswered(ROSTER, wanted);
    await this.applying;
    return view?.data !== undefined && wanted();
  }

  /** Since when the roster has gone without an answer, and why, for the app row: the web process in use serves it. */
  unanswered(): Unanswered | undefined {
    return this.roster.unanswered([ROSTER]);
  }

  /** A sign of life: retry a lost roster read now instead of waiting out the backoff. */
  wake(): void {
    this.roster.wake();
  }

  dispose(): void {
    this.roster.dispose();
  }

  /** The one place a roster answer reaches the state; a refusal is shown in its own words. */
  private mirror(): void {
    const entry = this.roster.entry(ROSTER);
    this.noticeFact(entry.fact.kind);
    const machines = entry.data;
    if (machines === undefined || machines === this.mirrored) return;
    this.mirrored = machines;
    this.applying = this.applyRoster(machines);
  }

  private async applyRoster(machines: Machine[]): Promise<void> {
    const asked = this.preferredMachineId();
    const initial = await this.selectInitialMachine(machines, asked);
    if (machines !== this.mirrored) return;
    const chosen = this.preferredMachineId();
    const selectedMachine = chosen === asked ? initial : machines.find((machine) => machine.id === (chosen ?? "local")) ?? this.localMachine(machines);
    const previous = this.getState().selectedMachine?.id;
    this.preference = { machineId: selectedMachine?.id, wanted: ALWAYS };
    const machineIds = new Set(machines.map((machine) => machine.id));
    this.setState({
      machines,
      selectedMachine,
      machinesLoad: "loaded",
      machineRuntimes: filterKeys(this.getState().machineRuntimes, machineIds),
      machineStatusSnapshots: filterKeys(this.getState().machineStatusSnapshots, machineIds),
    });
    void this.refreshMachineHealthFor(machines);
    void this.refreshMachineRuntimeFor(machines);
    if (previous !== undefined && selectedMachine?.id !== previous) void this.projects.loadProjects();
  }

  private preferredMachineId(): string | undefined {
    return this.preference.wanted() ? this.preference.machineId : this.getState().selectedMachine?.id;
  }

  /**
   * A machine this client added or removed: the known roster changes now, and
   * is read again, so an answer read before the change cannot leave it undone.
   */
  private rosterChanged(change: (machines: Machine[]) => Machine[]): void {
    this.roster.update(ROSTER, change);
    void this.roster.refresh(ROSTER);
  }

  private noticeFact(kind: ReadFact["kind"]): void {
    if (kind === this.noticedFact) return;
    this.noticedFact = kind;
    const words = FACT_WORDS.get(kind);
    if (words !== undefined) this.setState(errorNoticePatch(new Error(words)));
  }

  async selectMachine(machine: Machine, options: { updateUrl?: boolean | undefined } = {}): Promise<void> {
    this.preference = { machineId: machine.id, wanted: ALWAYS };
    if (this.getState().selectedMachine?.id === machine.id) return;
    this.setState({
      selectedMachine: machine,
      projects: [],
      projectsLoad: "loading",
      workspaces: [],
      isLoadingWorkspaces: false,
      selectedProject: undefined,
      selectedWorkspace: undefined,
      selectedSession: undefined,
      messages: [],
      messagePageStart: 0,
      messagePageTotal: 0,
      status: undefined,
      activity: undefined,
      sessionStatuses: {},
      sessionActivities: {},
      sendingPrompts: {},
      workspacesByProjectId: {},
      workspaceDeletionRuns: {},
      activeTerminalCount: 0,
      ...resetWorkspaceScopedState(),
    });
    if (options.updateUrl !== false) this.updateUrl();
    await this.projects.loadProjects();
    void this.refreshMachineHealth(machine.id);
    void this.refreshMachineRuntime(machine.id);
  }

  async updateMachine(machine: Machine, patch: { name?: string }): Promise<Machine | undefined> {
    this.setState(clearErrorPatch());
    try {
      const updated = await api.updateMachine(machine.id, patch);
      this.setState({ machines: this.getState().machines.map((candidate) => (candidate.id === updated.id ? updated : candidate)) });
      return updated;
    } catch (error) {
      this.setState(errorNoticePatch(error));
      return undefined;
    }
  }

  async addMachine(input: { name: string; baseUrl: string; token?: string }): Promise<Machine | undefined> {
    this.setState(clearErrorPatch());
    try {
      const machine = await api.addMachine(input);
      this.setState({ machines: [...this.getState().machines.filter((candidate) => candidate.id !== machine.id), machine] });
      await this.selectMachine(machine);
      this.rosterChanged((listed) => [...listed.filter((candidate) => candidate.id !== machine.id), machine]);
      return machine;
    } catch (error) {
      this.setState(errorNoticePatch(error));
      return undefined;
    }
  }

  async deleteMachine(machine: Machine | undefined = this.getState().selectedMachine, options: { selectFallback?: boolean } = {}): Promise<Machine | undefined> {
    if (machine === undefined) return undefined;
    if (machine.kind === "local") {
      // Reader-retired: nothing will arrive to retire it; the reader acts.
      this.setState(noticePatch(noticeForReader("The local machine cannot be removed.")));
      return undefined;
    }
    try {
      const wasSelected = this.getState().selectedMachine?.id === machine.id;
      await api.deleteMachine(machine.id);
      this.rosterChanged((listed) => listed.filter((candidate) => candidate.id !== machine.id));
      // The claim about this machine can never be disproved now - its scope
      // has no future replies - so it is retired with the machine rather than
      // left on screen describing something that no longer exists.
      if (this.getState().errorMachineId === machine.id) this.setState(clearErrorPatch());
      const machines = this.getState().machines.filter((candidate) => candidate.id !== machine.id);
      const local = machines.find((candidate) => candidate.id === "local") ?? machines[0];
      this.setState({ machines, machineStatuses: omitKey(this.getState().machineStatuses, machine.id), machineRuntimes: omitKey(this.getState().machineRuntimes, machine.id), machineStatusSnapshots: omitKey(this.getState().machineStatusSnapshots, machine.id) });
      if (wasSelected && local !== undefined) {
        if (options.selectFallback === false) return local;
        await this.selectMachine(local);
        return local;
      }
      return undefined;
    } catch (error) {
      this.setState(errorNoticePatch(error));
      return undefined;
    }
  }

  /**
   * The owner's wording for a machine that is not answering: named, with the
   * evidence, in the composed form whose prefix the wording table protects -
   * the anonymous "Reconnecting to the machine…" erased the one fact (which
   * machine) the reader could not see anywhere else.
   */
  private machineDownNotice(machineId: string, error: unknown): NoticePatch {
    const machine = this.getState().machines.find((candidate) => candidate.id === machineId);
    const detail = error instanceof Error ? /\((.*)\)/.exec(error.message)?.[1] : undefined;
    const text = `Trying to sync with ${machine?.name ?? machineId}…${detail === undefined ? "" : ` ${detail}`}`;
    return noticePatch(noticeFromTransport(text, machineId));
  }

  async refreshMachineHealth(machineId = this.getState().selectedMachine?.id ?? "local"): Promise<MachineHealth | undefined> {
    const seq = (this.healthRefreshSeqByMachine.get(machineId) ?? 0) + 1;
    this.healthRefreshSeqByMachine.set(machineId, seq);
    try {
      const health = await api.health(machineId);
      if (this.healthRefreshSeqByMachine.get(machineId) !== seq) return undefined;
      this.setState({ machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health } });
      return health;
    } catch (error) {
      // A late failure must not paint its machine's complaint onto the
      // machine the reader has since switched to.
      if (this.healthRefreshSeqByMachine.get(machineId) !== seq) return undefined;
      // The sequence guard only moves when the same machine is re-polled, so
      // it cannot see a machine switch; the selection check - the same one
      // the project and session controllers use - is what stops a late
      // failure from painting machine A's complaint onto machine B.
      if (selectedMachineId(this.getState()) !== machineId) return undefined;
      this.noticeReadFailure(error, "background");
      return undefined;
    }
  }

  private noticeReadFailure(error: unknown, asker: ReadAsker): void {
    const failure = readFailureNotice(classifyReadError(error), asker);
    if (failure.notice === "none") return;
    this.setState(failure.notice === "machine" ? this.machineDownNotice(failure.machineId, error) : errorNoticePatch(error));
  }

  /**
   * `requireSelected` is the background-refresh contract: the roster load and
   * the remote-restore ladder fire this for machines the reader may already
   * have left, and a late failure must not paint machine A's complaint onto
   * machine B - the sequence guard cannot see a machine switch, so the
   * selection check is what does (its twin in refreshMachineHealth has the
   * same check). The settings path passes false: the reader explicitly asked
   * for that machine's runtime, and its failure is the answer.
   */
  async refreshMachineRuntime(machineId = this.getState().selectedMachine?.id ?? "local", options: { requireSelected?: boolean } = {}): Promise<MachineRuntime | undefined> {
    const seq = (this.runtimeRefreshSeqByMachine.get(machineId) ?? 0) + 1;
    this.runtimeRefreshSeqByMachine.set(machineId, seq);
    try {
      const runtime = await api.runtime(machineId, true);
      if (this.runtimeRefreshSeqByMachine.get(machineId) !== seq) return undefined;
      this.setState({ machineRuntimes: { ...this.getState().machineRuntimes, [runtime.machineId]: runtime } });
      return runtime;
    } catch (error) {
      if (this.runtimeRefreshSeqByMachine.get(machineId) !== seq) return undefined;
      if (options.requireSelected !== false && selectedMachineId(this.getState()) !== machineId) return undefined;
      this.noticeReadFailure(error, options.requireSelected === false ? "reader" : "background");
      return undefined;
    }
  }

  private async selectInitialMachine(machines: Machine[], routeMachineId?: string): Promise<Machine | undefined> {
    const requestedMachine = machines.find((machine) => machine.id === (routeMachineId ?? "local"));
    if (requestedMachine === undefined) return this.localMachine(machines);
    if (requestedMachine.kind !== "remote") return requestedMachine;

    const health = await this.safeRemoteHealth(requestedMachine);
    this.setState({
      machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health },
      // Reply-retired and machine-scoped: the claim is that this machine's
      // link is down, so only a success from that machine disproves it - a
      // poll from anywhere else may not speak for it.
      ...(remoteReportedDown(health) ? noticePatch(noticeFromTransport(`Trying to sync with ${requestedMachine.name}…`, requestedMachine.id)) : {}),
    });
    return requestedMachine;
  }

  /**
   * A remote machine's health as the web process in use answered it. A read
   * that failed on the way says nothing about the remote: its health is
   * unknown, and the failure speaks as the app row's classifier says.
   */
  private async safeRemoteHealth(machine: Machine): Promise<MachineHealth> {
    try {
      return await api.health(machine.id);
    } catch (error) {
      this.noticeReadFailure(error, "background");
      return {
        machineId: machine.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        status: "unknown",
        error: describeError(error),
      };
    }
  }

  private localMachine(machines: Machine[]): Machine | undefined {
    return machines.find((machine) => machine.id === "local") ?? machines[0];
  }

  private async refreshMachineHealthFor(machines: Machine[]): Promise<void> {
    const results = await Promise.allSettled(machines.map((machine) => api.health(machine.id)));
    const health = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.machineId, result.value] as const] : []));
    if (Object.keys(health).length > 0) this.setState({ machineStatuses: { ...this.getState().machineStatuses, ...health } });
  }

  private async refreshMachineRuntimeFor(machines: Machine[]): Promise<void> {
    const results = await Promise.allSettled(machines.map((machine) => api.runtime(machine.id)));
    const runtimes = Object.fromEntries(results.flatMap((result) => result.status === "fulfilled" ? [[result.value.machineId, result.value] as const] : []));
    if (Object.keys(runtimes).length > 0) this.setState({ machineRuntimes: { ...this.getState().machineRuntimes, ...runtimes } });
  }
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function filterKeys<T>(record: Record<string, T>, allowedKeys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowedKeys.has(key)));
}
