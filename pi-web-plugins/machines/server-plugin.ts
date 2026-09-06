import type {
  MachineRegistryContribution,
  PiWebServerPlugin,
  ServerPluginActivationContext,
  ServerPluginHealth,
  ServerPluginReply,
  ServerPluginRouteBody,
  ServerPluginRouteContribution,
} from "@gang-of-beads/pi-web/server-plugin-api";
import { MachineService, type CreateMachineInput, type UpdateMachineInput } from "./server/machineService.js";
import { MachineStore, machineStorePathIn } from "./server/machineStore.js";

/**
 * The machine registry as a plugin. The plugin owns the store, the remote
 * client, the management routes and the registry face over them; the host
 * consumes the registry for its proxy families and fleet fan-out and never
 * learns what a machine store is. The routes keep the core-shaped paths the
 * browser already calls, mounted by the host under the API prefix and its
 * local-machine alias.
 */
const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Machines",
  activate: (context: ServerPluginActivationContext) => {
    const injected = context.ports?.machineRegistry;
    if (injected !== undefined) {
      return {
        machineRegistry: injected,
        routes: managementRoutes(injected),
      };
    }
    const storePath = context.ports?.machinesStorePath;
    const localRuntime = context.ports?.localRuntime;
    if (storePath === undefined || localRuntime === undefined) {
      return {
        health: (): Promise<ServerPluginHealth> => Promise.resolve({
          status: "unhealthy" as const,
          message: "This host does not inject the machines store path and local runtime ports the registry resolves through.",
        }),
      };
    }

    const machines = new MachineService(new MachineStore(machineStorePathIn(storePath())), { localRuntime });
    return {
      machineRegistry: machines,
      routes: managementRoutes(machines),
    };
  },
};

function managementRoutes(machines: MachineRegistryContribution): ServerPluginRouteContribution[] {
  return [listRoute(machines), addRoute(machines), healthRoute(machines), runtimeRoute(machines), getRoute(machines), updateRoute(machines), removeRoute(machines)];
}

function listRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "GET",
    path: "/machines",
    async handle(_request, reply) {
      await reply.header("Content-Type", "application/json").send(JSON.stringify({ machines: await machines.list() }));
    },
  };
}

function addRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "POST",
    path: "/machines",
    async handle(request, reply) {
      try {
        const machine = await machines.add(createInput(request.body));
        await sendJson(reply, machine);
      } catch (error) {
        await sendError(reply, error);
      }
    },
  };
}

function healthRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "GET",
    path: "/machines/:machineId/health",
    async handle(request, reply) {
      const machineId = request.params["machineId"];
      if (machineId === undefined) {
        await sendNotFound(reply);
        return;
      }
      const health = await machines.health(machineId);
      if (health === undefined) {
        await sendNotFound(reply);
        return;
      }
      await sendJson(reply, health);
    },
  };
}

function runtimeRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "GET",
    path: "/machines/:machineId/runtime",
    async handle(request, reply) {
      const machineId = request.params["machineId"];
      if (machineId === undefined) {
        await sendNotFound(reply);
        return;
      }
      const runtime = await machines.runtime(machineId, request.query["refresh"] === "1");
      if (runtime === undefined) {
        await sendNotFound(reply);
        return;
      }
      await sendJson(reply, runtime);
    },
  };
}

function getRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "GET",
    path: "/machines/:machineId",
    async handle(request, reply) {
      const machineId = request.params["machineId"];
      if (machineId === undefined) {
        await sendNotFound(reply);
        return;
      }
      const machine = await machines.get(machineId);
      if (machine === undefined) {
        await sendNotFound(reply);
        return;
      }
      await sendJson(reply, machine);
    },
  };
}

function updateRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "PATCH",
    path: "/machines/:machineId",
    async handle(request, reply) {
      try {
        const machineId = request.params["machineId"];
        if (machineId === undefined) {
          await sendNotFound(reply);
          return;
        }
        const machine = await machines.update(machineId, updateInput(request.body));
        if (machine === undefined) {
          await sendNotFound(reply);
          return;
        }
        await sendJson(reply, machine);
      } catch (error) {
        await sendError(reply, error);
      }
    },
  };
}

function removeRoute(machines: MachineRegistryContribution): ServerPluginRouteContribution {
  return {
    method: "DELETE",
    path: "/machines/:machineId",
    async handle(request, reply) {
      try {
        const machineId = request.params["machineId"];
        if (machineId === undefined) {
          await sendNotFound(reply);
          return;
        }
        const removed = await machines.remove(machineId);
        if (!removed) {
          await sendNotFound(reply);
          return;
        }
        await reply.header("Content-Type", "application/json").send(JSON.stringify({ deleted: true }));
      } catch (error) {
        await sendError(reply, error);
      }
    },
  };
}

function createInput(body: ServerPluginRouteBody | undefined): CreateMachineInput {
  return machineInput(body);
}

function updateInput(body: ServerPluginRouteBody | undefined): UpdateMachineInput {
  return machineInput(body);
}

function machineInput(body: ServerPluginRouteBody | undefined): CreateMachineInput {
  if (body === undefined || body instanceof Uint8Array) throw new Error("Request body must be a JSON object");
  const name = stringField(body, "name");
  const baseUrl = stringField(body, "baseUrl");
  const token = stringField(body, "token");
  const headers = headersField(body);
  return {
    ...(name === undefined ? {} : { name }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(token === undefined ? {} : { token }),
    ...(headers === undefined ? {} : { headers }),
  };
}

function stringField(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === "string" ? value : undefined;
}

function headersField(body: Record<string, unknown>): Record<string, string> | undefined {
  const value = body["headers"];
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const headers: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") return undefined;
    headers[key] = entry;
  }
  return headers;
}

async function sendJson(reply: ServerPluginReply, body: unknown): Promise<void> {
  await reply.header("Content-Type", "application/json").send(JSON.stringify(body));
}

async function sendNotFound(reply: ServerPluginReply): Promise<void> {
  await reply.code(404).header("Content-Type", "application/json").send(JSON.stringify({ error: "Machine not found" }));
}

async function sendError(reply: ServerPluginReply, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await reply.code(400).header("Content-Type", "application/json").send(JSON.stringify({ error: message }));
}

export default plugin;
