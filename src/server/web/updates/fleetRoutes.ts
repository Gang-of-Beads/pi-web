import type { FastifyInstance } from "fastify";
import type { Machine, MachineHealth, MachineRuntime, PiWebFleetOperation, PiWebFleetReport, PiWebFleetTargetOutcome, PiWebFleetTargetReport } from "../../../shared/apiTypes.js";
import { MachineService } from "../machines/machineService.js";
import type { RestartService } from "./restartRoutes.js";
import type { SelfUpdateService } from "./selfUpdateRoutes.js";

/**
 * Fleet operations, scoped to the machines this server knows.
 *
 * Restarting or updating "everything" used to depend on which session happened
 * to be selected: the slash command ran inside the agent process of the session
 * machine and fanned out over *that* machine's list, so the same words covered
 * a different set of machines depending on where the caller was standing. The
 * browser always talks to one server, so making that server do the fan-out
 * gives the operation a single, stated scope - and every report says which
 * server ran it and which machines it covered.
 *
 * Failures are per target, never fatal: one unreachable machine must not hide
 * the outcome for the rest, so a target's error is reported next to it.
 */

/**
 * The slice of the machine registry this fan-out needs. Declaring it as an
 * interface rather than the concrete service keeps the routes testable without
 * a machine store on disk, and states exactly how much authority they hold.
 */
export interface FleetMachines {
  list(): Promise<Machine[]>;
  localMachine(): Promise<Machine>;
  health(id: string): Promise<MachineHealth | undefined>;
  runtime(id: string, refresh?: boolean): Promise<MachineRuntime | undefined>;
  remoteClient(id: string): Promise<FleetMachineClient | undefined>;
}

/**
 * The one call a fan-out makes on a remote machine, narrowed to what it reads.
 * Restart and update reply 202 with the work detached, so the status code is
 * the whole answer; nothing here consumes the body.
 */
export interface FleetMachineClient {
  request(method: string, path: string, body?: unknown): Promise<{ statusCode: number }>;
}

export interface FleetRouteDeps {
  machines?: FleetMachines;
  restart?: RestartService;
  selfUpdate?: SelfUpdateService;
  /** Identity of the server running the fan-out, for the report header. */
  hubName?: () => Promise<string>;
}

const REMOTE_PATHS: Record<PiWebFleetOperation, string> = {
  restart: "/api/pi-web/restart",
  update: "/api/pi-web/update/apply",
};

export function registerFleetRoutes(app: FastifyInstance, deps: FleetRouteDeps = {}): void {
  const machines = deps.machines ?? new MachineService();

  app.get("/api/pi-web/fleet", async () => await fleetReport(machines, deps));

  app.post<{ Body: { operation?: unknown; machineIds?: unknown } | undefined }>("/api/pi-web/fleet/run", async (request, reply) => {
    const operation = parseOperation(request.body?.operation);
    if (operation === undefined) return reply.code(400).send({ error: "operation must be \"restart\" or \"update\"" });
    const requested = parseMachineIds(request.body?.machineIds);
    const targets = await resolveTargets(machines, requested);
    if (targets.length === 0) return reply.code(404).send({ error: "no machines matched" });

    const outcomes: PiWebFleetTargetOutcome[] = [];
    for (const target of targets) {
      outcomes.push(await runOnTarget(machines, deps, operation, target));
    }
    return {
      operation,
      hub: await hubIdentity(machines, deps),
      // Naming the covered machines is the point: "restart everything" is only
      // meaningful next to the list it actually reached.
      outcomes,
    };
  });
}

async function fleetReport(machines: FleetMachines, deps: FleetRouteDeps): Promise<PiWebFleetReport> {
  const list = await machines.list();
  const targets: PiWebFleetTargetReport[] = [];
  for (const machine of list) {
    const health = await machines.health(machine.id);
    const runtime = await machines.runtime(machine.id);
    targets.push({
      machineId: machine.id,
      name: machine.name,
      kind: machine.kind,
      online: health?.ok === true,
      // The runtime version a machine reports is what makes "they are all
      // updated" checkable instead of hoped for.
      ...versionFields(runtime),
      ...(health?.error === undefined ? {} : { error: health.error }),
    });
  }
  return { hub: await hubIdentity(machines, deps), machines: targets };
}

function versionFields(runtime: MachineRuntime | undefined): { version?: string; piVersion?: string } {
  const web = runtime?.components?.web;
  if (web === undefined) return {};
  return {
    ...(web.runtimeVersion === undefined ? {} : { version: web.runtimeVersion }),
    ...(web.piVersion === undefined ? {} : { piVersion: web.piVersion }),
  };
}

async function hubIdentity(machines: FleetMachines, deps: FleetRouteDeps): Promise<PiWebFleetReport["hub"]> {
  if (deps.hubName !== undefined) return { machineId: "local", name: await deps.hubName() };
  const local = await machines.localMachine();
  return { machineId: local.id, name: local.name };
}

async function resolveTargets(machines: FleetMachines, requested: string[] | undefined): Promise<{ id: string; name: string }[]> {
  const list = await machines.list();
  const all = list.map((machine) => ({ id: machine.id, name: machine.name }));
  if (requested === undefined) return all;
  // Accept names as well as ids: an operator types "hxd-pi", not a uuid.
  return all.filter((machine) => requested.includes(machine.id) || requested.includes(machine.name));
}

async function runOnTarget(
  machines: FleetMachines,
  deps: FleetRouteDeps,
  operation: PiWebFleetOperation,
  target: { id: string; name: string },
): Promise<PiWebFleetTargetOutcome> {
  try {
    if (target.id === "local") {
      await runLocally(deps, operation);
      return { machineId: target.id, name: target.name, started: true };
    }
    const client = await machines.remoteClient(target.id);
    if (client === undefined) return { machineId: target.id, name: target.name, started: false, error: "Machine not found" };
    const response = await client.request("POST", REMOTE_PATHS[operation], {});
    const started = response.statusCode >= 200 && response.statusCode < 300;
    return started
      ? { machineId: target.id, name: target.name, started: true }
      : { machineId: target.id, name: target.name, started: false, error: `${operation} responded ${String(response.statusCode)}` };
  } catch (error) {
    return { machineId: target.id, name: target.name, started: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runLocally(deps: FleetRouteDeps, operation: PiWebFleetOperation): Promise<void> {
  if (operation === "restart") {
    if (deps.restart === undefined) throw new Error("Restart is unavailable on this host");
    await deps.restart.restart();
    return;
  }
  if (deps.selfUpdate === undefined) throw new Error("Self-update is unavailable on this host");
  await deps.selfUpdate.apply();
}

function parseOperation(value: unknown): PiWebFleetOperation | undefined {
  return value === "restart" || value === "update" ? value : undefined;
}

function parseMachineIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids = value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "").map((entry) => entry.trim());
  return ids.length === 0 ? undefined : ids;
}
