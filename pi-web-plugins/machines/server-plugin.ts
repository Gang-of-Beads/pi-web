import type {
  MachineRegistryContribution,
  PiWebServerPlugin,
  ServerPluginActivationContext,
  ServerPluginHealth,
} from "@gang-of-beads/pi-web/server-plugin-api";
import { MachineService } from "./server/machineService.js";
import { MachineStore, machineStorePathIn } from "./server/machineStore.js";

/**
 * The machine registry as a plugin. The plugin owns the store, the remote
 * client and the management routes over them; the host consumes the registry
 * face for its proxy families and fleet fan-out and never learns what a
 * machine store is. Management routes are contributed in the same slice that
 * retires the core's own route family.
 */
const plugin: PiWebServerPlugin = {
  apiVersion: 1,
  name: "Machines",
  activate: (context: ServerPluginActivationContext): { machineRegistry?: MachineRegistryContribution; health?: (signal: AbortSignal) => Promise<ServerPluginHealth> } => {
    const storePath = context.ports?.machinesStorePath;
    const localRuntime = context.ports?.localRuntime;
    if (storePath === undefined || localRuntime === undefined) {
      return {
        health: () => Promise.resolve({
          status: "unhealthy" as const,
          message: "This host does not inject the machines store path and local runtime ports the registry resolves through.",
        }),
      };
    }

    const service = new MachineService(new MachineStore(machineStorePathIn(storePath())), { localRuntime });
    return { machineRegistry: service };
  },
};

export default plugin;
