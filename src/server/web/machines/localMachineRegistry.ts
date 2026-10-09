import { hostname } from "node:os";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Machine, MachineClient, MachineHealth, MachineRuntime, PiWebRuntimeResponse, PluginMachineCreateInput, PluginMachineUpdateInput } from "../../../server-plugin-api.js";

/**
 * The machine registry face core consumes when the machines plugin is absent.
 * The bundled machines plugin owns the real registry; this fallback keeps the
 * same answer an empty store gives - the local machine, no remotes, no
 * management - so the proxy and fleet routes degrade honestly instead of
 * crashing. The user's local alias lives in the plugin's store, and the
 * fallback's local health omits the per-component statuses it cannot know,
 * which the surfaces render as the unknown state they are.
 */
export function localMachineFallback(localRuntime: () => Promise<PiWebRuntimeResponse>): MachineRegistryFace {
  return {
    list: async () => [await localMachine()],
    get: async (id) => id === "local" ? await localMachine() : undefined,
    localMachine,
    add: () => Promise.reject(new Error("Machine management runs on the machines plugin, which is not active")),
    update: () => Promise.resolve(undefined),
    remove: () => Promise.resolve(false),
    health: (id) => Promise.resolve(id === "local" ? localHealth(localRuntime) : undefined),
    runtime: (id) => Promise.resolve(id === "local" ? localRuntimeSnapshot(localRuntime) : undefined),
    remoteClient: () => Promise.resolve(undefined),
  };
}

/**
 * The machine reads the page makes, answered by core when no plugin supplies the registry: the
 * list, one machine, its health and its runtime, from the fallback, in the shapes the machines
 * plugin's own routes answer. Without them a PI WEB with no machines plugin answered each with
 * route-missing, the page read that as "this machine runs an older PI WEB" and asked again every
 * few seconds (owner, 2026-10-09, on a PI WEB with no plugins at all). Adding, renaming, ordering
 * and removing machines stay the plugin's: only its own pages offer them.
 */
export function registerFallbackMachineRoutes(app: FastifyInstance, machines: Pick<MachineRegistryFace, "list" | "get" | "health" | "runtime">): void {
  app.get("/api/machines", async () => ({ machines: await machines.list() }));
  app.get<{ Params: { machineId: string } }>("/api/machines/:machineId", async (request, reply) => answerOrNotFound(reply, await machines.get(request.params.machineId)));
  app.get<{ Params: { machineId: string } }>("/api/machines/:machineId/health", async (request, reply) => answerOrNotFound(reply, await machines.health(request.params.machineId)));
  app.get<{ Params: { machineId: string }; Querystring: { refresh?: string } }>("/api/machines/:machineId/runtime", async (request, reply) => answerOrNotFound(reply, await machines.runtime(request.params.machineId, request.query.refresh === "1")));
}

async function answerOrNotFound(reply: FastifyReply, value: unknown): Promise<unknown> {
  if (value !== undefined) return value;
  return await reply.code(404).send({ error: "Machine not found" });
}

export interface MachineRegistryFace {
  list(): Promise<Machine[]>;
  get(id: string): Promise<Machine | undefined>;
  localMachine(): Promise<Machine>;
  add(input: PluginMachineCreateInput): Promise<Machine>;
  update(id: string, input: PluginMachineUpdateInput): Promise<Machine | undefined>;
  remove(id: string): Promise<boolean>;
  health(id: string): Promise<MachineHealth | undefined>;
  runtime(id: string, refresh?: boolean): Promise<MachineRuntime | undefined>;
  remoteClient(id: string): Promise<MachineClient | undefined>;
}

const LOCAL_MACHINE_TIMESTAMP = "1970-01-01T00:00:00.000Z";

function localMachine(): Promise<Machine> {
  return Promise.resolve({ id: "local", name: localMachineName(), kind: "local", createdAt: LOCAL_MACHINE_TIMESTAMP, updatedAt: LOCAL_MACHINE_TIMESTAMP });
}

/**
 * The local machine's name when no machines plugin runs to keep a renamed one: the computer's host
 * name without the `.local` macOS adds, as the machines plugin names it before a rename.
 */
export function localMachineName(): string {
  const name = hostname().trim().replace(/\.local$/iu, "");
  return name === "" ? "Local" : name;
}

async function localHealth(localRuntime: () => Promise<PiWebRuntimeResponse>): Promise<MachineHealth> {
  const checkedAt = new Date().toISOString();
  try {
    await localRuntime();
    return { machineId: "local", ok: true, checkedAt, status: "online" };
  } catch (error) {
    return { machineId: "local", ok: false, checkedAt, status: "error", error: error instanceof Error ? error.message : String(error) };
  }
}

async function localRuntimeSnapshot(localRuntime: () => Promise<PiWebRuntimeResponse>): Promise<MachineRuntime> {
  const checkedAt = new Date().toISOString();
  try {
    await localRuntime();
    return { machineId: "local", ok: true, checkedAt };
  } catch (error) {
    return { machineId: "local", ok: false, checkedAt, error: error instanceof Error ? error.message : String(error) };
  }
}
