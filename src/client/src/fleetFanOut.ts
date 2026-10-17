import type { Machine, MachineConnection, MachineHealth, MachineRuntime, PiWebFleetOperation, PiWebFleetReport, PiWebFleetRunResponse, PiWebFleetTargetOutcome, PiWebFleetTargetReport } from "../../shared/apiTypes";

/**
 * "Update / restart all machines", fanned out by this browser (docs/design/browser-direct-machines.md,
 * decision 3a): "all" is the machines this page shows and reaches. A machine reached through this
 * PI WEB is still run, and read, by the server, as before; a machine this browser reaches directly
 * is read and started by the browser itself, since the server may not reach it at all - and its
 * Online, versions and outcome are what this device sees.
 */
export interface FleetFanOutApi {
  report(): Promise<PiWebFleetReport>;
  run(operation: PiWebFleetOperation, machineIds: readonly string[]): Promise<PiWebFleetRunResponse>;
  health(machineId: string): Promise<MachineHealth>;
  runtime(machineId: string): Promise<MachineRuntime>;
  /** Start the operation on a machine this browser reaches directly; resolves once it answered. */
  start(machineId: string, operation: PiWebFleetOperation): Promise<void>;
}

function connectionOf(machines: readonly Machine[], machineId: string): MachineConnection {
  return machines.find((machine) => machine.id === machineId)?.connectFrom ?? "server";
}

/** The fleet as this device sees it: the server's report, with each direct machine read from here. */
export async function fleetReportFromHere(api: FleetFanOutApi, machines: readonly Machine[]): Promise<PiWebFleetReport> {
  const report = await api.report();
  const targets = await Promise.all(report.machines.map((target) => TARGET_READ[connectionOf(machines, target.machineId)](api, target)));
  return { ...report, machines: targets };
}

const TARGET_READ: Readonly<Record<MachineConnection, (api: FleetFanOutApi, target: PiWebFleetTargetReport) => Promise<PiWebFleetTargetReport>>> = {
  server: (_api, target) => Promise.resolve(target),
  browser: async (api, target) => {
    const [health, runtime] = await Promise.allSettled([api.health(target.machineId), api.runtime(target.machineId)]);
    const web = runtime.status === "fulfilled" ? runtime.value.components?.web : undefined;
    const answered = health.status === "fulfilled" ? health.value : undefined;
    const error = health.status === "rejected" ? "This browser cannot reach the machine." : answered?.error;
    return {
      machineId: target.machineId,
      name: target.name,
      kind: target.kind,
      online: answered?.ok === true,
      ...(answered?.web === undefined ? {} : { reachable: answered.web.available }),
      ...(web?.runtimeVersion === undefined ? {} : { version: web.runtimeVersion }),
      ...(web?.piVersion === undefined ? {} : { piVersion: web.piVersion }),
      ...(error === undefined ? {} : { error }),
    };
  },
};

/**
 * Run one operation on the machines named (every listed machine when none are): the server runs its
 * own share in one request, the browser starts each direct machine itself, and the outcomes come back
 * in the list's order, one per machine, a failure next to its machine.
 */
export async function runFleetFromHere(api: FleetFanOutApi, machines: readonly Machine[], operation: PiWebFleetOperation, machineIds?: readonly string[]): Promise<PiWebFleetRunResponse> {
  const targets = (machineIds ?? machines.map((machine) => machine.id)).map((machineId) => machines.find((machine) => machine.id === machineId) ?? { id: machineId, name: machineId, kind: "remote" as const });
  const serverIds = targets.filter((machine) => connectionOf(machines, machine.id) === "server").map((machine) => machine.id);
  const [serverRun, browserOutcomes] = await Promise.all([
    serverIds.length === 0 ? Promise.resolve(undefined) : api.run(operation, serverIds).catch((error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) })),
    Promise.all(targets.filter((machine) => connectionOf(machines, machine.id) === "browser").map((machine) => startFromHere(api, machine, operation))),
  ]);
  const outcomes = targets.map((machine) => browserOutcomes.find((outcome) => outcome.machineId === machine.id) ?? serverOutcome(serverRun, machine));
  const local = machines.find((machine) => machine.id === "local");
  const hub = serverRun !== undefined && "hub" in serverRun ? serverRun.hub : { machineId: "local", name: local?.name ?? "this PI WEB" };
  return { operation, hub, outcomes };
}

/** A server-run machine's line: what the server reported for it, or why the server's run did not answer. */
function serverOutcome(serverRun: PiWebFleetRunResponse | { failed: string } | undefined, machine: Pick<Machine, "id" | "name">): PiWebFleetTargetOutcome {
  const reported = serverRun !== undefined && "outcomes" in serverRun ? serverRun.outcomes.find((outcome) => outcome.machineId === machine.id) : undefined;
  const error = serverRun !== undefined && "failed" in serverRun ? `The server did not start it: ${serverRun.failed}` : "The server did not report on this machine.";
  return reported ?? { machineId: machine.id, name: machine.name, started: false, error };
}

async function startFromHere(api: FleetFanOutApi, machine: Pick<Machine, "id" | "name">, operation: PiWebFleetOperation): Promise<PiWebFleetTargetOutcome> {
  try {
    await api.start(machine.id, operation);
    return { machineId: machine.id, name: machine.name, started: true };
  } catch (error) {
    return { machineId: machine.id, name: machine.name, started: false, error: error instanceof Error ? error.message : String(error) };
  }
}
