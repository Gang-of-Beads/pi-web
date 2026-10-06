import { afterEach, describe, expect, it, vi } from "vitest";
import { api, HttpError, type Machine, type MachineHealth } from "../api";
import { initialAppState, type AppState } from "../appState";
import { machineStatusSnapshot } from "../machineStatus.testSupport";
import { MachineController } from "./machineController";

const localMachine: Machine = {
  id: "local",
  name: "Local",
  kind: "local",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
};

const remoteMachine: Machine = {
  id: "remote-1",
  name: "Remote",
  kind: "remote",
  baseUrl: "http://remote.example.test:8504",
  createdAt: "2026-05-26T00:00:00.000Z",
  updatedAt: "2026-05-26T00:00:00.000Z",
};

const addedMachine: Machine = {
  id: "remote-2",
  name: "New Remote",
  kind: "remote",
  baseUrl: "https://new-remote.example.test",
  createdAt: "2026-05-27T00:00:00.000Z",
  updatedAt: "2026-05-27T00:00:00.000Z",
};

const offlineHealth: MachineHealth = {
  machineId: remoteMachine.id,
  ok: false,
  checkedAt: "2026-05-26T00:00:01.000Z",
  status: "offline",
  error: "Remote machine request timed out",
};

describe("MachineController", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("selects a newly added machine and clears stale workspace state", async () => {
    const project = { id: "p1", name: "Project", path: "/repo", createdAt: "now" };
    const workspace = { id: "w1", projectId: project.id, path: "/repo", label: "main", isMain: true, effectiveConfig: {} };
    const session = { id: "s1", cwd: "/repo", path: "/repo/.pi/sessions/s1.json", created: "now", modified: "now", messageCount: 1, firstMessage: "hello" };
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      projects: [project],
      workspaces: [workspace],
      sessions: [session],
      selectedProject: project,
      selectedWorkspace: workspace,
      selectedSession: session,
      activeTerminalCount: 2,
      error: "stale error",
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };
    const input = { name: "New Remote", baseUrl: "https://new-remote.example.test", token: "secret-token" };

    const addMachine = vi.spyOn(api, "addMachine").mockResolvedValue(addedMachine);
    const health = vi.spyOn(api, "health").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "2026-05-27T00:00:01.000Z", status: "online" });
    const runtime = vi.spyOn(api, "runtime").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "2026-05-27T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const machine = await controller.addMachine(input);

    expect(machine).toEqual(addedMachine);
    expect(addMachine).toHaveBeenCalledWith(input);
    expect(state.machines).toEqual([localMachine, remoteMachine, addedMachine]);
    expect(state.selectedMachine).toEqual(addedMachine);
    expect(state.projects).toEqual([]);
    expect(state.workspaces).toEqual([]);
    expect(state.sessions).toEqual([]);
    expect(state.selectedProject).toBeUndefined();
    expect(state.selectedWorkspace).toBeUndefined();
    expect(state.selectedSession).toBeUndefined();
    expect(state.activeTerminalCount).toBe(0);
    expect(state.error).toBe("");
    expect(projects.loadProjects).toHaveBeenCalledOnce();
    expect(updateUrl).toHaveBeenCalledOnce();
    expect(health).toHaveBeenCalledWith(addedMachine.id);
    expect(runtime).toHaveBeenCalledWith(addedMachine.id, true);
  });

  it("keeps machine status snapshots when switching machines", async () => {
    // Machine rows and their project rows now read the same snapshot, so
    // selecting a machine can no longer leave a lit machine dot standing over
    // descendant state that selection cleared.
    const snapshot = machineStatusSnapshot({ machine: { "core:working": true }, projects: { p1: { "core:working": true } } });
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      machineStatusSnapshots: { local: snapshot },
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "health").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "2026-05-27T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "2026-05-27T00:00:02.000Z" });
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.selectMachine(remoteMachine, { updateUrl: false });

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatusSnapshots).toEqual({ local: snapshot });
  });

  it("preserves the current machine state when adding a machine fails", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };
    const input = { name: "New Remote", baseUrl: "https://new-remote.example.test" };

    vi.spyOn(api, "addMachine").mockRejectedValue(new Error("Remote rejected"));
    const health = vi.spyOn(api, "health");
    const runtime = vi.spyOn(api, "runtime");

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const machine = await controller.addMachine(input);

    expect(machine).toBeUndefined();
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("Remote rejected");
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
    expect(health).not.toHaveBeenCalled();
    expect(runtime).not.toHaveBeenCalled();
  });

  it("keeps the routed remote machine selected while its health is offline", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockImplementation((machineId: string) => Promise.resolve(
      machineId === remoteMachine.id
        ? offlineHealth
        : { machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" },
    ));

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(state.machineStatuses[remoteMachine.id]).toEqual(offlineHealth);
    expect(state.error).toContain("Trying to sync with Remote");
  });

  /**
   * The routed machine stays selected when its health read fails; falling
   * back to local would flatten the deep link. The failed read is not
   * evidence about the remote (review 98e437b2): its health is unknown, and
   * the notice follows the classifier the app row uses.
   */
  it("keeps the routed remote selected when its health read fails, and does not blame the remote for it", async () => {
    const outcomes: Record<string, { selected: string | undefined; status: string | undefined; error: string }> = {};
    for (const [label, failure] of [
      ["nothing answered", new TypeError("Failed to fetch")],
      ["a server error", new HttpError("Internal Server Error", 500, remoteMachine.id)],
    ] as const) {
      let state: AppState = initialAppState();
      const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
      vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
      vi.spyOn(api, "health").mockRejectedValue(failure);
      vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "now" });
      const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
      await controller.loadMachines(remoteMachine.id);
      outcomes[label] = { selected: state.selectedMachine?.id, status: state.machineStatuses[remoteMachine.id]?.status, error: state.error };
      controller.dispose();
    }
    expect(outcomes).toEqual({
      "nothing answered": { selected: remoteMachine.id, status: "unknown", error: "" },
      "a server error": { selected: remoteMachine.id, status: "unknown", error: "Internal Server Error" },
    });
  });

  it("drops the status snapshot of a machine that is no longer configured", async () => {
    // A machine removed from another tab or device must not keep lighting rows
    // from its previous daemon's tree if its id is ever reused.
    const localSnapshot = machineStatusSnapshot({ machine: { "core:working": true } });
    let state: AppState = {
      ...initialAppState(),
      machines: [localMachine, remoteMachine],
      selectedMachine: localMachine,
      machineStatusSnapshots: { local: localSnapshot, [remoteMachine.id]: machineStatusSnapshot() },
    };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    await controller.loadMachines();

    expect(state.machineStatusSnapshots).toEqual({ local: localSnapshot });
  });

  it("falls back to local when the routed machine is no longer configured", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    await controller.loadMachines(remoteMachine.id);

    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("");
  });

  it("returns the fallback machine without selecting it when requested", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const fallback = await controller.deleteMachine(remoteMachine, { selectFallback: false });

    expect(fallback).toEqual(localMachine);
    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine).toEqual(remoteMachine);
    expect(projects.loadProjects).not.toHaveBeenCalled();
    expect(updateUrl).not.toHaveBeenCalled();
  });

  it("does not let an older runtime response overwrite a newer capability negotiation", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    let resolveOlder: ((runtime: Awaited<ReturnType<typeof api.runtime>>) => void) | undefined;
    const older = new Promise<Awaited<ReturnType<typeof api.runtime>>>((resolve) => { resolveOlder = resolve; });
    vi.spyOn(api, "runtime")
      .mockImplementationOnce(() => older)
      .mockResolvedValueOnce({ machineId: "local", ok: true, checkedAt: "new", capabilities: [] });
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });

    const first = controller.refreshMachineRuntime("local");
    const second = controller.refreshMachineRuntime("local");
    await second;
    resolveOlder?.({ machineId: "local", ok: true, checkedAt: "old", capabilities: [] });
    await first;

    expect(state.machineRuntimes["local"]).toMatchObject({ checkedAt: "new", capabilities: [] });
  });

  it("selects the fallback machine after deleting the selected machine by default", async () => {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine, selectedProject: { id: "p1", name: "Project", path: "/repo", createdAt: "now" } };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const updateUrl = vi.fn();
    const projects = { loadProjects: vi.fn() };

    vi.spyOn(api, "deleteMachine").mockResolvedValue({ deleted: true });

    const controller = new MachineController(() => state, setState, updateUrl, projects);

    const fallback = await controller.deleteMachine(remoteMachine);

    expect(fallback).toEqual(localMachine);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.selectedProject).toBeUndefined();
    expect(projects.loadProjects).toHaveBeenCalledOnce();
    expect(updateUrl).toHaveBeenCalledOnce();
  });
});

describe("MachineController load discipline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("moves machinesLoad through loading to loaded on a successful roster", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };

    vi.spyOn(api, "machines").mockResolvedValue([localMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    const loading = controller.loadMachines();
    expect(state.machinesLoad).toBe("loading");
    await loading;

    expect(state.machinesLoad).toBe("loaded");
    expect(state.machines).toEqual([localMachine]);
  });

  /**
   * B48: a roster read that got no answer is not an outcome. It used to set
   * machinesLoad "failed" and paint the banner; now the known roster stays,
   * nothing is reported, and the read runs again by itself.
   */
  it("keeps the known roster through a lost read, reports nothing, and applies the answer its own retry gets", async () => {
    vi.useFakeTimers();
    let state: AppState = { ...initialAppState(), machines: [localMachine], selectedMachine: localMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const machinesMock = vi.spyOn(api, "machines").mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "2026-05-26T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    await controller.loadMachines("local");

    expect(state.machinesLoad).toBe("loading");
    expect(state.machines).toEqual([localMachine]);
    expect(state.error).toBe("");
    expect(controller.unanswered()?.miss).toEqual({ kind: "link-down" });

    await vi.advanceTimersByTimeAsync(1000);

    expect(machinesMock).toHaveBeenCalledTimes(2);
    expect(state.machinesLoad).toBe("loaded");
    expect(state.machines).toEqual([localMachine, remoteMachine]);
    expect(state.selectedMachine).toEqual(localMachine);
    expect(state.error).toBe("");
    expect(controller.unanswered()).toBeUndefined();
    controller.dispose();
  });

  it("shows a refusal the server stated in its own words, and does not read it again", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const machinesMock = vi.spyOn(api, "machines").mockRejectedValue(new HttpError("Forbidden", 403));

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    await controller.loadMachines();

    expect(state.error).toContain("refused to list the machines");
    expect(state.machinesLoad).toBe("loading");
    expect(machinesMock).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("answers a remote deep link once the roster answers, selecting the machine it names", async () => {
    vi.useFakeTimers();
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "machines").mockRejectedValueOnce(new TypeError("Failed to fetch")).mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "2026-05-26T00:00:01.000Z", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: remoteMachine.id, ok: true, checkedAt: "2026-05-26T00:00:02.000Z" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    await controller.loadMachines(remoteMachine.id);
    let answered: boolean | undefined;
    void controller.rosterAnswered(() => true).then((result) => { answered = result; });
    await vi.advanceTimersByTimeAsync(3000);

    expect(answered).toBe(true);
    expect(state.selectedMachine?.id).toBe(remoteMachine.id);
    expect(state.machinesLoad).toBe("loaded");
    controller.dispose();
  });

  it("stops waiting for the roster once the reader no longer wants it", async () => {
    vi.useFakeTimers();
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "machines").mockRejectedValue(new TypeError("Failed to fetch"));

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    await controller.loadMachines();
    let wanted = true;
    let answered: boolean | undefined;
    void controller.rosterAnswered(() => wanted).then((result) => { answered = result; });
    wanted = false;
    await vi.advanceTimersByTimeAsync(2000);

    expect(answered).toBe(false);
    controller.dispose();
  });
});

/**
 * Review 6088e664: a roster answer can land long after it was asked for - a
 * retry after a lost read, or a remote machine's health read in between. It
 * must select the machine the reader wants when it lands, not the one asked
 * for when the read began.
 */
describe("MachineController selects what the reader wants when the roster lands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the current selection once the deep link it was asked for is no longer wanted", async () => {
    vi.useFakeTimers();
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "machines").mockRejectedValueOnce(new TypeError("Failed to fetch")).mockResolvedValue([localMachine, remoteMachine]);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now" });
    let wanted = true;

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    await controller.loadMachines(remoteMachine.id, () => wanted);
    wanted = false;
    await vi.advanceTimersByTimeAsync(1000);

    expect(state.machinesLoad).toBe("loaded");
    expect(state.selectedMachine?.id).toBe("local");
    controller.dispose();
  });

  it("keeps a machine the reader chose while the answer waited on a health read", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "machines").mockResolvedValue([localMachine, remoteMachine]);
    let answerHealth: (health: MachineHealth) => void = () => undefined;
    vi.spyOn(api, "health").mockImplementation((machineId) => machineId === remoteMachine.id && state.selectedMachine === undefined
      ? new Promise<MachineHealth>((resolve) => { answerHealth = resolve; })
      : Promise.resolve({ machineId, ok: true, checkedAt: "now", status: "online" }));
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now" });
    const loadProjects = vi.fn();

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects });
    const loading = controller.loadMachines(remoteMachine.id);
    await Promise.resolve();
    await Promise.resolve();
    await controller.selectMachine(localMachine);
    answerHealth({ ...offlineHealth, ok: true, status: "online" });
    await loading;

    expect(state.selectedMachine?.id).toBe("local");
    expect(loadProjects).toHaveBeenCalledOnce();
    controller.dispose();
  });

  it("ends with a removed machine gone, even when an answer read before the removal lands after it", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const reads: ((machines: Machine[]) => void)[] = [];
    vi.spyOn(api, "machines").mockImplementation(() => new Promise<Machine[]>((resolve) => { reads.push(resolve); }));
    vi.spyOn(api, "deleteMachine").mockResolvedValue(undefined);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: "local", ok: true, checkedAt: "now" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    const booting = controller.loadMachines("local");
    reads[0]?.([localMachine, remoteMachine]);
    await booting;
    const rereading = controller.loadMachines("local");
    await controller.deleteMachine(remoteMachine);
    reads[1]?.([localMachine, remoteMachine]);
    await rereading;
    await vi.waitFor(() => { if (reads.length < 3) throw new Error("the roster has not been read again after the removal"); });
    reads[2]?.([localMachine]);
    await vi.waitFor(() => { if (state.machines.length !== 1) throw new Error("the removed machine is still listed"); });

    expect(state.machines).toEqual([localMachine]);
    expect(state.selectedMachine?.id).toBe("local");
    controller.dispose();
  });

  it("lists and selects a machine the reader added, through the roster", async () => {
    let state: AppState = initialAppState();
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    vi.spyOn(api, "machines").mockResolvedValueOnce([localMachine]).mockResolvedValue([localMachine, addedMachine]);
    vi.spyOn(api, "addMachine").mockResolvedValue(addedMachine);
    vi.spyOn(api, "health").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "now", status: "online" });
    vi.spyOn(api, "runtime").mockResolvedValue({ machineId: addedMachine.id, ok: true, checkedAt: "now" });

    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    await controller.loadMachines("local");
    await controller.addMachine({ name: addedMachine.name, baseUrl: "https://new-remote.example.test" });
    await vi.waitFor(() => { if (state.machines.length !== 2) throw new Error("the added machine is not listed"); });

    expect(state.selectedMachine?.id).toBe(addedMachine.id);
    expect(state.machines.map((machine) => machine.id)).toEqual(["local", addedMachine.id]);
    controller.dispose();
  });
});

/**
 * Review 98e437b2 (DeepSeek P2-1): a machine's health and runtime are read
 * from the local web process, which answers 200 with ok:false when a remote is
 * down. A failed health read is therefore never evidence about the remote
 * machine: a proxy in front of PI WEB answering 502 during a reload named the
 * remote "unavailable" in a notice that outranked the app row. The notice
 * follows the one classifier the row uses.
 */
describe("MachineController says what a failed health or runtime read means", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function selectedRemote() {
    let state: AppState = { ...initialAppState(), machines: [localMachine, remoteMachine], selectedMachine: remoteMachine };
    const setState = (patch: Partial<AppState>) => { state = { ...state, ...patch }; };
    const controller = new MachineController(() => state, setState, vi.fn(), { loadProjects: vi.fn() });
    return { controller, read: () => state };
  }

  it("writes nothing for a read nothing answered: the app row speaks for it", async () => {
    const outcomes: Record<string, string> = {};
    for (const [label, error] of [
      ["a proxy's bare 502", new HttpError("Bad Gateway", 502, remoteMachine.id)],
      ["a dropped connection", new TypeError("Failed to fetch")],
    ] as const) {
      vi.spyOn(api, "health").mockRejectedValueOnce(error);
      vi.spyOn(api, "runtime").mockRejectedValueOnce(error);
      const { controller, read } = selectedRemote();
      await controller.refreshMachineHealth(remoteMachine.id);
      await controller.refreshMachineRuntime(remoteMachine.id);
      outcomes[label] = read().error;
      controller.dispose();
    }
    expect(outcomes).toEqual({ "a proxy's bare 502": "", "a dropped connection": "" });
  });

  it("names the machine only when the gateway said it did not answer", async () => {
    vi.spyOn(api, "health").mockRejectedValueOnce(new HttpError("Remote machine unavailable (connect ECONNREFUSED)", 502, remoteMachine.id, "gateway"));
    const { controller, read } = selectedRemote();
    await controller.refreshMachineHealth(remoteMachine.id);
    expect(read().error).toBe("Trying to sync with Remote… connect ECONNREFUSED");
    controller.dispose();
  });

  it("shows a server error in its own words", async () => {
    vi.spyOn(api, "health").mockRejectedValueOnce(new HttpError("Machine not found", 404, remoteMachine.id));
    const { controller, read } = selectedRemote();
    await controller.refreshMachineHealth(remoteMachine.id);
    expect(read().error).toContain("Machine not found");
    controller.dispose();
  });

  it("still answers a runtime read the reader asked for, even when nothing answered", async () => {
    vi.spyOn(api, "runtime").mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const { controller, read } = selectedRemote();
    await controller.refreshMachineRuntime(remoteMachine.id, { requireSelected: false });
    expect(read().error).not.toBe("");
    controller.dispose();
  });
});
