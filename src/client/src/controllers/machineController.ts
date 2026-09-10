import { api, type Machine, type MachineHealth, type MachineRuntime } from "../api";
import { resetWorkspaceScopedState } from "../appState";
import { clearErrorPatch, errorNoticePatch, noticePatch } from "../errorNotice";
import { describeError, noticeForReader, noticeFromTransport } from "../notice";
import { selectedMachineId, type GetState, type SetState, type UpdateUrl } from "./types";
import type { ProjectController } from "./projectController";

export class MachineController {
  private readonly healthRefreshSeqByMachine = new Map<string, number>();
  private readonly runtimeRefreshSeqByMachine = new Map<string, number>();

  constructor(private readonly getState: GetState, private readonly setState: SetState, private readonly updateUrl: UpdateUrl, private readonly projects: Pick<ProjectController, "loadProjects">) {}

  async loadMachines(routeMachineId?: string): Promise<void> {
    this.setState({ ...clearErrorPatch(), isLoadingMachines: true, machinesLoad: "loading" });
    try {
      const machines = await api.machines();
      const selectedMachine = await this.selectInitialMachine(machines, routeMachineId);
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
    } catch (error) {
      // The previous roster stays on screen — a failed listing is not
      // evidence that the machines are gone — and `failed` sticks until a
      // load succeeds, mirroring projectsLoad's discipline.
      this.setState({ ...errorNoticePatch(error), machinesLoad: "failed" });
    } finally {
      this.setState({ isLoadingMachines: false });
    }
  }

  async selectMachine(machine: Machine, options: { updateUrl?: boolean | undefined } = {}): Promise<void> {
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
      this.setState(errorNoticePatch(error));
      return undefined;
    }
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
      this.setState(errorNoticePatch(error));
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
      ...(health.ok ? {} : noticePatch(noticeFromTransport(`${requestedMachine.name} is unavailable; reconnecting…`, requestedMachine.id))),
    });
    return requestedMachine;
  }

  private async safeRemoteHealth(machine: Machine): Promise<MachineHealth> {
    try {
      return await api.health(machine.id);
    } catch (error) {
      return {
        machineId: machine.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        status: "offline",
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
