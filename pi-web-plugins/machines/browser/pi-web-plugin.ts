import { html, type TemplateResult } from "lit";
import { createRef, ref, type Ref } from "lit/directives/ref.js";
import type { MachineSectionContribution, MachineSectionContext, PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { MachineList } from "./MachineList";
import "./MachineSwitcher";
import { openAddMachineDialog } from "./addMachineDialog";
import { rememberMachinesHost } from "./hostUi";

/**
 * The machine fleet as a plugin. The shell keeps the selection engine, the
 * section order, the keyboard machine, and the collapse state, and feeds this
 * module a plain snapshot per machine with the health check folded in; the
 * list and the compact switcher render from that snapshot alone. The add
 * dialog opens through the shell's dialog seam behind the reserved
 * `add-machine` action, the same handoff the add-project dialog uses.
 */

const listRef: Ref<MachineList> = createRef();

function renderMachinesList(context: MachineSectionContext): TemplateResult {
  const display = context.display;
  return html`<machine-list
    ${ref(listRef)}
    .hidden=${display.hidden}
    .machines=${[...context.machines]}
    .selectedMachineId=${context.selectedMachineId}
    .machineFlags=${context.machineFlags}
    .collapsible=${display.collapsible}
    .collapsed=${display.collapsed}
    .onToggleCollapsed=${() => { context.toggleCollapsed(); }}
    .onAdd=${display.withCreate && context.addMachine !== undefined ? () => { context.addMachine?.(); } : undefined}
    .onSelect=${(machineId: string) => { context.selectMachine(machineId); }}
    .onRemove=${context.removeMachine === undefined ? undefined : (machineId: string) => { context.removeMachine?.(machineId); }}
    .onRename=${context.renameMachine === undefined ? undefined : (machineId: string, name: string) => { context.renameMachine?.(machineId, name); }}
    .onRefresh=${context.refreshMachine === undefined ? undefined : (machineId: string) => { context.refreshMachine?.(machineId); }}
    .onOpen=${context.openMachine === undefined ? undefined : (machineId: string) => { context.openMachine?.(machineId); }}
    .onFocusNextSection=${() => { void context.focusNextSection(); }}
    .onCancelKeyboardNavigation=${() => { void context.cancelKeyboardNavigation(); }}
  ></machine-list>`;
}

/**
 * The compact surface's picker: the same fleet through the switcher form. The
 * phone shell mounts it in the header and keeps it hidden for keyboard
 * navigation, which is the switcher element's own `:host([hidden])` contract.
 */
function renderMachinesSwitcher(context: MachineSectionContext): TemplateResult {
  return html`<machine-switcher
    hidden
    .machines=${[...context.machines]}
    .selectedMachineId=${context.selectedMachineId}
    .machineFlags=${context.machineFlags}
    .onSelect=${(machineId: string) => { context.selectMachine(machineId); }}
    .onRemove=${context.removeMachine === undefined ? undefined : (machineId: string) => { context.removeMachine?.(machineId); }}
    .onFocusNextSection=${() => { void context.focusNextSection(); }}
    .onCancelKeyboardNavigation=${() => { void context.cancelKeyboardNavigation(); }}
  ></machine-switcher>`;
}

export function machinesSection(): MachineSectionContribution {
  return {
    id: "machines",
    focus: async () => await listRef.value?.focusSelectedOrFirst() ?? false,
    render: (context) => (context.display.tiles ? renderMachinesSwitcher(context) : renderMachinesList(context)),
  };
}

const machinesPlugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Machines",
  activate: (context) => {
    rememberMachinesHost(context.ui);
    return {
      contributions: {
        machineSections: [machinesSection()],
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
