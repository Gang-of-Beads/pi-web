import type { ApprovedMachineOrigin, MachineAccessRequestState, MachineAccessRequestView } from "../../../shared/machineAccess";
import { isRecord } from "../../../shared/unknownValues";
import { request } from "./http";

/**
 * This machine's side of browser access (docs/design/browser-direct-machines.md): read a request
 * another machine's page left, decide it, and keep the approved origins. Every path is this
 * machine's own, so they resolve against the page like any other API path.
 */

export type MachineAccessDecision = "approve" | "deny";

const REQUEST_STATES: ReadonlySet<string> = new Set<MachineAccessRequestState>(["pending", "approved", "denied"]);

function isRequestState(value: unknown): value is MachineAccessRequestState {
  return typeof value === "string" && REQUEST_STATES.has(value);
}

function textField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new Error(`Expected string field: ${key}`);
  return value;
}

export function parseMachineAccessRequest(value: unknown): MachineAccessRequestView {
  if (!isRecord(value)) throw new Error("Expected a machine access request");
  const state = value["state"];
  if (!isRequestState(state)) throw new Error("Expected a machine access request state");
  return {
    id: textField(value, "id"),
    origin: textField(value, "origin"),
    name: textField(value, "name"),
    code: textField(value, "code"),
    state,
    expiresAt: textField(value, "expiresAt"),
  };
}

export function parseApprovedMachineOrigins(value: unknown): ApprovedMachineOrigin[] {
  if (!isRecord(value) || !Array.isArray(value["approved"])) throw new Error("Expected { approved: [] }");
  return value["approved"].map((entry: unknown) => {
    if (!isRecord(entry)) throw new Error("Expected an approved origin");
    return { origin: textField(entry, "origin"), name: textField(entry, "name"), approvedAt: textField(entry, "approvedAt") };
  });
}

function parseRemoved(value: unknown): boolean {
  return isRecord(value) && value["removed"] === true;
}

const REQUESTS_PATH = "api/machine-access/requests";

export const machineAccessApi = {
  machineAccessRequest: (id: string) => request(`${REQUESTS_PATH}/${encodeURIComponent(id)}`, parseMachineAccessRequest),
  decideMachineAccess: (id: string, decision: MachineAccessDecision) => request(`${REQUESTS_PATH}/${encodeURIComponent(id)}/${decision}`, parseMachineAccessRequest, { method: "POST" }),
  approvedMachineOrigins: () => request("api/machine-access/approved", parseApprovedMachineOrigins),
  forgetApprovedMachineOrigin: (origin: string) => request(`api/machine-access/approved?${new URLSearchParams({ origin }).toString()}`, parseRemoved, { method: "DELETE" }),
};
