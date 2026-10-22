import type { PiWebFleetOperation, PiWebStatusResponse } from "../../shared/apiTypes";
import { installationRestartRefusal, installationRestartState } from "../../shared/serviceRestart";

/**
 * Which of a Settings → Machines row's keys the machine itself would act on, read from its own
 * PI WEB status. A second PI WEB on the same account refuses Restart and an inherited Update
 * (the services installed for this user run another PI WEB), so the row drew keys the server only
 * refused. The row decides by the server's own rule (`installationRestartState` in
 * `shared/serviceRestart.ts`) and says the server's own reason in place of a withheld key.
 *
 * While the machine's status is on its way the row has no keys, so it never offers one its server
 * would refuse. A machine that reports no service state - an older one, Windows, Docker, a host
 * without a service manager - or whose status could not be read keeps both keys: its server still
 * decides when one is pressed.
 */
export interface FleetMachineOffer {
  readonly restart: boolean;
  readonly update: boolean;
  /** Why a key is withheld, in the words the Updates page and the Settings field use; empty when nothing is withheld or no reason is given. */
  readonly notes: readonly string[];
}

/** A row's status read: asked and not answered yet, answered, or not readable. */
export type FleetStatusRead =
  | { readonly kind: "reading" }
  | { readonly kind: "read"; readonly status: PiWebStatusResponse }
  | { readonly kind: "unread" };

export const FLEET_STATUS_READING: FleetStatusRead = { kind: "reading" };

const UNREPORTED: FleetMachineOffer = { restart: true, update: true, notes: [] };
const READING: FleetMachineOffer = { restart: false, update: false, notes: [] };

/** The update command a status does not offer can be saved in this PI WEB's Settings, which the server does not gate. */
const UPDATE_NOTE = "Save an update command in Settings to update from here.";

/**
 * `undefined`: no read was asked for, because the machine is not reachable. The offer then withholds
 * nothing; the row's reachability is what disables its keys.
 */
export function fleetMachineOffer(read: FleetStatusRead | undefined): FleetMachineOffer {
  if (read === undefined || read.kind === "unread") return UNREPORTED;
  if (read.kind === "reading") return READING;
  return offerOfStatus(read.status);
}

/**
 * Restart is offered where the installation's state, by the rule the server refuses with, is
 * confirmed, and its refusal is the row's note; the update only where the status offers its command.
 */
function offerOfStatus(status: PiWebStatusResponse): FleetMachineOffer {
  const states = [status.components.web.serviceRestart, status.components.sessiond.serviceRestart].filter((state) => state !== undefined);
  if (states.length === 0) return UNREPORTED;
  const installation = installationRestartState(states);
  const command = status.commands.update;
  const update = command !== undefined && command !== "";
  const restartNote = installationRestartRefusal[installation];
  return {
    restart: installation === "confirmed",
    update,
    notes: [...(restartNote === undefined ? [] : [restartNote]), ...(update ? [] : [UPDATE_NOTE])],
  };
}

/**
 * The machines "Update every machine" or "Restart every machine" sends, from the reachable machines
 * its caller passes: those whose row offers the operation, so a bulk run never sends one the row
 * withholds or cannot reach. `undefined` while any row's status is still being read: the bulk key
 * waits for every row to know its keys.
 */
export function fleetBulkTargets(machineIds: readonly string[], statuses: Readonly<Record<string, FleetStatusRead>>, operation: PiWebFleetOperation): readonly string[] | undefined {
  if (machineIds.some((machineId) => statuses[machineId]?.kind === "reading")) return undefined;
  return machineIds.filter((machineId) => fleetMachineOffer(statuses[machineId])[operation]);
}
