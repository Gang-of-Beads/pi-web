import type { MachineStatus } from "../../shared/apiTypes";

export type MachineReachability = "checking" | "trying" | MachineStatus;

export interface MachineReachabilityView {
  readonly state: MachineReachability;
  readonly text: string;
}

/** What a machine reads before anything about it is known for the current view. */
export const CHECKING_REACHABILITY: MachineReachabilityView = { state: "checking", text: "Checking…" };
