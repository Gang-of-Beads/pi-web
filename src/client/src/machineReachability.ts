/**
 * What a Machines list shows for a machine (owner, 2026-10-23): Online, Offline, or Error for a
 * machine that answered with a fault. `checking` is nothing known yet: the line stays blank until
 * the first answer.
 */
export type MachineReachability = "checking" | "online" | "offline" | "error";

export interface MachineReachabilityView {
  readonly state: MachineReachability;
  readonly text: string;
  /** Why the machine is Offline or in Error, when that is known: the card's tooltip and a plugin's `reason`. */
  readonly reason?: string;
}

const REACHABILITY_WORDS: Readonly<Record<MachineReachability, string>> = {
  checking: "",
  online: "Online",
  offline: "Offline",
  error: "Error",
};

/** The view of a state, in the lists' words, with its reason when there is one. */
export function reachabilityView(state: MachineReachability, reason?: string): MachineReachabilityView {
  const text = REACHABILITY_WORDS[state];
  return reason === undefined || reason === "" ? { state, text } : { state, text, reason };
}

/** What a machine reads before anything about it is known for the current view. */
export const CHECKING_REACHABILITY: MachineReachabilityView = reachabilityView("checking");
