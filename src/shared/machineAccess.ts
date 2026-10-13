/**
 * The wire shapes of browser access between machines (docs/design/browser-direct-machines.md):
 * a request another machine's page leaves, and the origins this machine approved. Kept out of
 * apiTypes, which is compiled into the published plugin API.
 */

export type MachineAccessRequestState = "pending" | "approved" | "denied";

/** A request for access as both pages read it: who asks, the name it gave, the code to compare. */
export interface MachineAccessRequestView {
  readonly id: string;
  readonly origin: string;
  /** The name the requesting page gave; display only, the origin is what is trusted. */
  readonly name: string;
  readonly code: string;
  readonly state: MachineAccessRequestState;
  readonly expiresAt: string;
}

export interface ApprovedMachineOrigin {
  readonly origin: string;
  /** The name the requesting page gave; display only, the origin is what is trusted. */
  readonly name: string;
  readonly approvedAt: string;
}
