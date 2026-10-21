import type { Machine, MachineRuntime } from "./api";
import { CHECKING_REACHABILITY, type MachineReachability, type MachineReachabilityView } from "./machineReachability";
import { REQUEST_TIMEOUT_MS } from "./api/requestDeadline";
import { TRANSIENT_GRACE_MS } from "./components/bannerHold";
import { reachWords, syncWords } from "./sync/rowWords";

const UNANSWERED_RUNTIME_WORDS: Readonly<Record<"error" | "unknown" | "offline", string>> = {
  error: "Error",
  unknown: "Unknown · Runtime availability is unconfirmed",
  offline: "Offline",
};

function unavailableWords(component: string, reason: string | undefined): string {
  return reason === undefined ? component : `${component} · ${reason}`;
}

export function runtimeAvailability(runtime: MachineRuntime): MachineReachabilityView {
  const components = runtime.components;
  if (components === undefined) {
    const state = runtime.status === "error" ? "error" : runtime.ok ? "unknown" : "offline";
    return { state, text: runtime.error ?? UNANSWERED_RUNTIME_WORDS[state] };
  }
  if (!components.web.available) return { state: "error", text: unavailableWords("Web/API is unavailable", components.web.error) };
  if (!components.sessiond.available) return { state: "error", text: unavailableWords("Session daemon is unavailable", components.sessiond.error) };
  return runtime.ok ? { state: "online", text: "Online" } : { state: "error", text: runtime.error ?? "PI WEB is unavailable" };
}

/**
 * Where a machine's reachability comes from: this page's own check (an answer, an answered error, or
 * r60's Trying/Offline clock), this browser's record of an earlier check of the same target, or
 * nothing yet. The Machines lists draw both known states; whatever acts on reachability (the plugin
 * fleet and its reachability facts) takes only what this page confirmed.
 */
export type MachineReachabilityBasis = "confirmed" | "remembered" | "unknown";

export interface MachineReachabilityReading {
  readonly basis: MachineReachabilityBasis;
  readonly view: MachineReachabilityView;
}

const CONFIRMED_VIEWS: Readonly<Record<MachineReachabilityBasis, (view: MachineReachabilityView) => MachineReachabilityView>> = {
  confirmed: (view) => view,
  remembered: () => CHECKING_REACHABILITY,
  unknown: () => CHECKING_REACHABILITY,
};

export function confirmedReachability(reading: MachineReachabilityReading): MachineReachabilityView {
  return CONFIRMED_VIEWS[reading.basis](reading.view);
}

/**
 * What this page's check of a machine has seen since it last started checking it (a new target, or
 * a return to the list): whether the machine answered since then, its last answer (undefined after
 * a check that got none), and since when the current check has had no answer. An answer from
 * before a pause is not one: until the machine answers again it counts as remembered.
 */
export interface ProbeObservation {
  readonly answered: boolean;
  readonly result: MachineReachabilityView | undefined;
  readonly unansweredSince: number | undefined;
}

/**
 * Whether 10 s without an answer may replace what the browser remembers, before the machine has
 * answered this page's check (owner, 2026-10-21): over a remembered Online, Trying or nothing it
 * may; a remembered Offline, error or Unknown already says more, and flipping it to Trying and back
 * at 30 s would be a change nothing on the machine made. Once the machine has answered, a check
 * without an answer follows r60: Trying at 10 s, Offline at 30 s.
 */
const TRYING_REPLACES_REMEMBERED: Readonly<Record<MachineReachability, boolean>> = {
  checking: true,
  trying: true,
  online: true,
  error: false,
  offline: false,
  unknown: false,
};

function tryingView(machine: Pick<Machine, "kind" | "name">): MachineReachabilityView {
  return { state: "trying", text: machine.kind === "local" ? reachWords(machine.name) : syncWords(machine.name) };
}

function rememberedReading(remembered: MachineReachabilityView | undefined, machine: Pick<Machine, "kind" | "name">): MachineReachabilityReading {
  if (remembered === undefined) return { basis: "unknown", view: CHECKING_REACHABILITY };
  return { basis: "remembered", view: remembered.state === "trying" ? tryingView(machine) : remembered };
}

export function machineProbeReading(observed: ProbeObservation | undefined, now: number, machine: Pick<Machine, "kind" | "name">, remembered: MachineReachabilityView | undefined): MachineReachabilityReading {
  const answered = observed?.answered === true;
  const since = observed?.unansweredSince;
  const elapsed = since === undefined ? 0 : now - since;
  if (elapsed >= REQUEST_TIMEOUT_MS) return { basis: "confirmed", view: { state: "offline", text: "Offline" } };
  const trying = elapsed >= TRANSIENT_GRACE_MS && (answered || TRYING_REPLACES_REMEMBERED[(remembered ?? CHECKING_REACHABILITY).state]);
  if (trying) return { basis: "confirmed", view: tryingView(machine) };
  const result = answered ? observed.result : undefined;
  if (result !== undefined) return { basis: "confirmed", view: result };
  return rememberedReading(remembered, machine);
}
