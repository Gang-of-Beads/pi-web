import { api, type Machine, type MachineHealth, type MachineRuntime } from "../api";
import type { MachineConnection } from "../../../shared/apiTypes";
import { resetWorkspaceScopedState } from "../appState";
import { clearErrorPatch, errorNoticePatch, noticePatch, type NoticeFields } from "../errorNotice";
import { describeError, noticeForReader, noticeFromTransport, type Notice } from "../notice";
import { classifyReadError, QUIET_WINDOW_MS, type ReadFact, type ReadMiss, type ReadOutcome } from "../sync/readPhase";
import { ScopedResource, type Unanswered } from "../sync/scopedResource";
import { syncWords } from "../sync/rowWords";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import type { ProjectController } from "./projectController";
import { orderedById } from "../../../shared/listOrder";
import { directMachinesOf, setDirectMachines } from "../directMachineUrl";
import { machineAccessApi } from "../api/machineAccess";
import type { ReadAsker } from "../api/http";

/**
 * What removing a machine does to this page's access on it. A machine this browser reaches directly
 * approved this page; removed here, it is asked to forget the page too, so the access does not
 * outlive the machine in the list. The ask is not waited for - a machine is usually removed because
 * it is gone, and a dead peer held the removal for the whole request deadline; one that cannot be
 * reached keeps the approval, which its own Settings list can remove. A machine reached through this
 * PI WEB never approved the page.
 */
const PAGE_ACCESS_ON_REMOVAL: Readonly<Record<MachineConnection, (machineId: string) => Promise<void>>> = {
  browser: async (machineId) => { await machineAccessApi.forgetThisPageOn(machineId).catch(() => undefined); },
  server: async () => { await Promise.resolve(); },
};

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

type RemoteDownAnswer = "unanswered" | "answered-error";

/**
 * Owner Q9 (readPhase.ts): only a remote that did not answer is a claim about its link, worded as
 * syncing and retired by its next answer; a remote that answered with an error (its session daemon
 * down) shows its name and reason, which only the reader retires.
 */
const REMOTE_DOWN_NOTICE: Readonly<Record<RemoteDownAnswer, (machine: Pick<Machine, "id" | "name">, reason: string | undefined) => Notice>> = {
  unanswered: (machine, reason) => noticeFromTransport(`${syncWords(machine.name)}${reason === undefined ? "" : ` ${reason}`}`, machine.id),
  "answered-error": (machine, reason) => noticeForReader(`${machine.name}: ${reason ?? "PI WEB is unavailable"}`, machine.id),
};

/** The notice for a remote the web process in use reported down; undefined when the health is not that answer. */
export function remoteReportedDownNotice(health: MachineHealth | undefined, machine: Pick<Machine, "id" | "name">): Notice | undefined {
  if (health === undefined || !remoteReportedDown(health)) return undefined;
  return REMOTE_DOWN_NOTICE[health.status === "error" ? "answered-error" : "unanswered"](machine, health.error);
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

  /**
   * The roster's machines reach the URL boundary before anything is read from them: choosing the
   * initial machine reads its health before the roster is in state, and that first read of a machine
   * this browser reaches itself went through this server (live check, 2026-10-13). The state write
   * below keeps the boundary in step for every later change (`PiWebApp.setState`).
   */
  private async applyRoster(machines: Machine[]): Promise<void> {
    setDirectMachines(directMachinesOf(machines));
    const asked = this.preferredMachineId();
    const initial = await this.selectInitialMachine(machines, asked);
    if (machines !== this.mirrored) return;
    const chosen = this.preferredMachineId();
    const selectedMachine = chosen === asked ? initial : machines.find((machine) => machine.id === (chosen ?? "local")) ?? this.localMachine(machines);
    const previous = this.getState().selectedMachine?.id;
    this.preference = { machineId: selectedMachine?.id, wanted: ALWAYS };
    const machineIds = new Set(machines.map((machine) => machine.id));
    for (const id of this.healthRefreshSeqByMachine.keys()) if (!machineIds.has(id)) this.beginHealthRead(id);
    for (const id of this.runtimeRefreshSeqByMachine.keys()) if (!machineIds.has(id)) this.beginRuntimeRead(id);
    this.setState({
      machines,
      machineStatuses: filterKeys(this.getState().machineStatuses, machineIds),
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

  /** The machines in the order the reader dragged them into (R11): on the page at once, then the web process's answer. */
  async reorderMachines(order: readonly string[]): Promise<void> {
    const before = this.getState().machines.map((machine) => machine.id);
    this.setState({ machines: orderedById(this.getState().machines, order) });
    this.roster.update(ROSTER, (listed) => orderedById(listed, order));
    try {
      const answered = await api.reorderMachines(order);
      this.roster.update(ROSTER, () => answered);
    } catch (error) {
      this.setState({ machines: orderedById(this.getState().machines, before), ...errorNoticePatch(error) });
      this.roster.update(ROSTER, (listed) => orderedById(listed, before));
      void this.roster.refresh(ROSTER);
    }
  }

  async addMachine(input: { name: string; baseUrl: string; token?: string; connectFrom?: MachineConnection }): Promise<Machine | undefined> {
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

  /**
   * Ask the gateway to remove a machine from this PI WEB. Throws when it refused or did not answer,
   * so the caller can tell the two apart; the page changes in `applyRemovedMachine`, once a removal
   * is known to be done, from this answer or from a read after a lost one.
   */
  async deleteMachine(machine: Machine | undefined = this.getState().selectedMachine, options: { keepalive?: boolean } = {}): Promise<void> {
    if (machine === undefined) return;
    if (machine.kind === "local") {
      // Reader-retired: nothing will arrive to retire it; the reader acts.
      this.setState(noticePatch(noticeForReader("The local machine cannot be removed.")));
      return;
    }
    void PAGE_ACCESS_ON_REMOVAL[machine.connectFrom ?? "server"](machine.id);
    await api.deleteMachine(machine.id, options.keepalive === true ? { keepalive: true } : undefined);
  }

  /**
   * A machine the gateway removed leaves the roster and the page. Returns the machine the page would
   * pick next when the removed one was selected, without selecting it: the caller moves there.
   */
  applyRemovedMachine(machineId: string): Machine | undefined {
    const wasSelected = this.getState().selectedMachine?.id === machineId;
    this.rosterChanged((listed) => listed.filter((candidate) => candidate.id !== machineId));
    // The claim about this machine can never be disproved now - its scope
    // has no future replies - so it is retired with the machine rather than
    // left on screen describing something that no longer exists.
    if (this.getState().errorMachineId === machineId) this.setState(clearErrorPatch());
    const machines = this.getState().machines.filter((candidate) => candidate.id !== machineId);
    const local = machines.find((candidate) => candidate.id === "local") ?? machines[0];
    this.beginHealthRead(machineId);
    this.beginRuntimeRead(machineId);
    this.setState({ machines, machineStatuses: omitKey(this.getState().machineStatuses, machineId), machineRuntimes: omitKey(this.getState().machineRuntimes, machineId), machineStatusSnapshots: omitKey(this.getState().machineStatusSnapshots, machineId) });
    return wasSelected ? local : undefined;
  }

  /**
   * The owner's wording for a machine that is not answering: named, with the
   * evidence, in the composed form whose prefix the wording table protects -
   * the anonymous "Reconnecting to the machine…" erased the one fact (which
   * machine) the reader could not see anywhere else.
   */
  private machineDownNotice(machineId: string, error: unknown): NoticeFields {
    const machine = this.getState().machines.find((candidate) => candidate.id === machineId);
    const detail = error instanceof Error ? /\((.*)\)/.exec(error.message)?.[1] : undefined;
    const text = `${syncWords(machine?.name ?? machineId)}${detail === undefined ? "" : ` ${detail}`}`;
    return noticePatch(noticeFromTransport(text, machineId));
  }

  private beginHealthRead(machineId: string): number {
    const seq = (this.healthRefreshSeqByMachine.get(machineId) ?? 0) + 1;
    this.healthRefreshSeqByMachine.set(machineId, seq);
    return seq;
  }

  async refreshMachineHealth(machineId = this.getState().selectedMachine?.id ?? "local"): Promise<MachineHealth | undefined> {
    const seq = this.beginHealthRead(machineId);
    try {
      const health = await api.health(machineId);
      if (this.healthRefreshSeqByMachine.get(machineId) !== seq) return undefined;
      this.setState({ machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health } });
      return health;
    } catch (error) {
      // A late failure must not paint its machine's complaint onto the
      // machine the reader has since switched to.
      if (this.healthRefreshSeqByMachine.get(machineId) !== seq) return undefined;
      this.setState({ machineStatuses: { ...this.getState().machineStatuses, [machineId]: unreadHealth(machineId, error) } });
      // The sequence guard moves on a re-poll, a removal or a roster drop of
      // the same machine, so it cannot see a machine switch; the selection check - the same one
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
  private beginRuntimeRead(machineId: string): number {
    const seq = (this.runtimeRefreshSeqByMachine.get(machineId) ?? 0) + 1;
    this.runtimeRefreshSeqByMachine.set(machineId, seq);
    return seq;
  }

  /**
   * The reader chose "Refresh" for a machine this server reaches: this server ends its pause after the
   * machine refused its access token, so the reads that follow contact it again. A machine this
   * browser reaches itself has no such pause. An older server without the route has none either, so a
   * failure here is left to the reads that follow, which say what the machine answers.
   */
  async endRefusalPause(machine: Pick<Machine, "id" | "kind" | "connectFrom">): Promise<void> {
    if (machine.kind !== "remote" || machine.connectFrom === "browser") return;
    await api.recheckMachine(machine.id).catch(() => undefined);
  }

  async refreshMachineRuntime(machineId = this.getState().selectedMachine?.id ?? "local", options: { requireSelected?: boolean } = {}): Promise<MachineRuntime | undefined> {
    const seq = this.beginRuntimeRead(machineId);
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

    const seq = this.beginHealthRead(requestedMachine.id);
    const health = await this.safeRemoteHealth(requestedMachine, () => this.healthRefreshSeqByMachine.get(requestedMachine.id) === seq && this.preferredMachineId() === requestedMachine.id);
    if (this.healthRefreshSeqByMachine.get(requestedMachine.id) !== seq) return requestedMachine;
    const downNotice = remoteReportedDownNotice(health, requestedMachine);
    this.setState({
      machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health },
      ...(downNotice === undefined ? {} : noticePatch(downNotice)),
    });
    return requestedMachine;
  }

  /**
   * A remote machine's health as the web process in use answered it. A read
   * that failed on the way says nothing about the remote: its health is
   * unknown, and the failure speaks as the app row's classifier says.
   */
  private async safeRemoteHealth(machine: Machine, wanted: () => boolean): Promise<MachineHealth> {
    try {
      return await api.health(machine.id);
    } catch (error) {
      if (wanted()) this.noticeReadFailure(error, "background");
      return unreadHealth(machine.id, error);
    }
  }

  private localMachine(machines: Machine[]): Machine | undefined {
    return machines.find((machine) => machine.id === "local") ?? machines[0];
  }

  /**
   * Each machine's health as it answers: the Machines list shows a quick machine's answer without
   * waiting for the slowest. A read that failed on the way leaves the machine unknown, with why,
   * rather than no answer at all.
   */
  private async refreshMachineHealthFor(machines: Machine[]): Promise<void> {
    await Promise.all(machines.map(async (machine) => {
      const seq = this.beginHealthRead(machine.id);
      const health = await api.health(machine.id).catch((error: unknown) => unreadHealth(machine.id, error));
      if (this.healthRefreshSeqByMachine.get(machine.id) !== seq) return;
      this.setState({ machineStatuses: { ...this.getState().machineStatuses, [health.machineId]: health } });
    }));
  }

  private async refreshMachineRuntimeFor(machines: Machine[]): Promise<void> {
    await Promise.allSettled(machines.map(async (machine) => {
      const seq = this.beginRuntimeRead(machine.id);
      const runtime = await api.runtime(machine.id);
      if (this.runtimeRefreshSeqByMachine.get(machine.id) !== seq) return;
      this.setState({ machineRuntimes: { ...this.getState().machineRuntimes, [machine.id]: runtime } });
    }));
  }
}

function omitKey<T>(record: Record<string, T>, keyToOmit: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => key !== keyToOmit));
}

function unreadHealth(machineId: string, error: unknown): MachineHealth {
  return { machineId, ok: false, checkedAt: new Date().toISOString(), status: "unknown", error: describeError(error) };
}

function filterKeys<T>(record: Record<string, T>, allowedKeys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => allowedKeys.has(key)));
}
