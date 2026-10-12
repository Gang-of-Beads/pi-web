/**
 * Whether a machine answers, in one classifier every surface reads.
 *
 * The Navigate Machines list drew only a name, so two machines that had been unreachable for
 * hours looked exactly like the one in use (owner, 2026-10-12: "I switch to the Machines page and
 * there is no status at all"); Settings drew a colour dot with no words. A machine nobody has
 * asked about yet is `checking`, and one whose read failed on the way is `unknown`: neither
 * is drawn as online, and neither is drawn as nothing.
 */
import type { MachineHealth, MachineStatus } from "../../shared/apiTypes";

export type MachineReachability = "checking" | MachineStatus;

export interface MachineReachabilityView {
  readonly state: MachineReachability;
  /** The words under the machine's name: the state, and, when it is not online, the recorded error, from the machine or from the failed read. */
  readonly text: string;
}

const WORDS: Readonly<Record<MachineReachability, string>> = {
  checking: "Checking…",
  online: "Online",
  offline: "Offline",
  error: "Error",
  unknown: "Unknown",
};

export function machineReachability(health: MachineHealth | undefined): MachineReachabilityView {
  const state: MachineReachability = health === undefined ? "checking" : health.status ?? (health.ok ? "online" : "unknown");
  const reason = state === "online" || state === "checking" ? undefined : health?.error;
  return { state, text: reason === undefined || reason === "" ? WORDS[state] : `${WORDS[state]} · ${reason}` };
}
