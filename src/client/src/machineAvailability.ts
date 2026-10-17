import type { Machine, MachineRuntime } from "./api";
import type { MachineReachabilityView } from "./machineReachability";
import { REQUEST_TIMEOUT_MS } from "./api/requestDeadline";
import { TRANSIENT_GRACE_MS } from "./components/bannerHold";
import { reachWords, syncWords } from "./sync/rowWords";

const UNANSWERED_RUNTIME_WORDS: Readonly<Record<"error" | "unknown" | "offline", string>> = {
  error: "Error",
  unknown: "Unknown · Runtime availability is unconfirmed",
  offline: "Offline",
};

export function runtimeAvailability(runtime: MachineRuntime): MachineReachabilityView {
  const components = runtime.components;
  if (components === undefined) {
    const state = runtime.status === "error" ? "error" : runtime.ok ? "unknown" : "offline";
    return { state, text: runtime.error ?? UNANSWERED_RUNTIME_WORDS[state] };
  }
  if (!components.web.available) return { state: "error", text: components.web.error ?? "Web/API is unavailable" };
  if (!components.sessiond.available) return { state: "error", text: components.sessiond.error ?? "Session daemon is unavailable" };
  return runtime.ok ? { state: "online", text: "Online" } : { state: "error", text: runtime.error ?? "PI WEB is unavailable" };
}

export function machineProbeView(result: MachineReachabilityView | undefined, unansweredSince: number | undefined, now: number, machine: Pick<Machine, "kind" | "name">): MachineReachabilityView {
  if (unansweredSince !== undefined) {
    const elapsed = now - unansweredSince;
    if (elapsed >= REQUEST_TIMEOUT_MS) return { state: "offline", text: "Offline" };
    if (elapsed >= TRANSIENT_GRACE_MS) return { state: "trying", text: machine.kind === "local" ? reachWords(machine.name) : syncWords(machine.name) };
  }
  return result ?? { state: "checking", text: "Checking…" };
}
