import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { openAddMachineDialog } from "./addMachineDialog";
import { rememberMachinesHost } from "./hostUi";

/**
 * The machine fleet's actions as a plugin. The Navigate page lists the machines itself; this
 * module brings the add dialog, which opens through the shell's dialog seam behind the reserved
 * `add-machine` action (the same handoff the add-project dialog uses), and the refresh, open and
 * remove actions for the selected machine. Its machines section was removed with the
 * `machineSections` contribution, which no surface rendered (B47).
 */

const machinesPlugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Machines",
  activate: (context) => {
    rememberMachinesHost(context.ui);
    return {
      contributions: {
        actions: [
          {
            id: "add-machine",
            title: "Add machine",
            description: "Register another PI WEB runtime reachable from this gateway",
            group: "Machine",
            run: (runtimeContext) => { openAddMachineDialog(runtimeContext); },
          },
          {
            id: "refresh-machine",
            title: "Refresh selected machine",
            description: "Check whether the selected PI WEB runtime is online",
            group: "Machine",
            enabled: (runtimeContext) => runtimeContext.state.selectedMachine !== undefined,
            run: (runtimeContext) => { void runtimeContext.refreshMachine?.(runtimeContext.state.selectedMachine?.id ?? "local"); },
          },
          {
            id: "open-machine",
            title: "Open selected machine PI WEB",
            description: "Open the selected remote PI WEB directly in a new tab",
            group: "Machine",
            enabled: (runtimeContext) => runtimeContext.state.selectedMachine?.kind === "remote",
            run: (runtimeContext) => { void runtimeContext.openMachine?.(runtimeContext.state.selectedMachine?.id ?? "local"); },
          },
          {
            id: "remove-machine",
            title: "Remove selected machine",
            description: "Remove the selected remote machine from this gateway",
            group: "Machine",
            enabled: (runtimeContext) => runtimeContext.state.selectedMachine?.kind === "remote",
            run: (runtimeContext) => { void runtimeContext.removeMachine?.(runtimeContext.state.selectedMachine?.id ?? "local"); },
          },
        ],
      },
    };
  },
};

export default machinesPlugin;
