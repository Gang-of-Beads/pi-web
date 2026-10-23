import type { MachineRuntime } from "./api";
import { CHECKING_REACHABILITY, reachabilityView, type MachineReachabilityView } from "./machineReachability";
import { REQUEST_TIMEOUT_MS } from "./api/requestDeadline";

function unavailableWords(component: string, reason: string | undefined): string {
  return reason === undefined ? component : `${component} · ${reason}`;
}

/**
 * A machine's state from its runtime answer. Error is an answer that names a fault, such as a
 * stopped session daemon; an answer that does not report its components but says it is fine is
 * Online, as the machine did answer.
 */
export function runtimeAvailability(runtime: MachineRuntime): MachineReachabilityView {
  const components = runtime.components;
  if (components === undefined) {
    if (runtime.status === "error") return reachabilityView("error", runtime.error ?? "PI WEB answered with an error");
    return runtime.ok ? reachabilityView("online") : reachabilityView("offline", runtime.error);
  }
  if (!components.web.available) return reachabilityView("error", unavailableWords("Web/API is unavailable", components.web.error));
  if (!components.sessiond.available) return reachabilityView("error", unavailableWords("Session daemon is unavailable", components.sessiond.error));
  return runtime.ok ? reachabilityView("online") : reachabilityView("error", runtime.error ?? "PI WEB is unavailable");
}

/** A session daemon whose announcements socket has not opened for the request deadline is Offline; before that nothing is known. */
export function unansweredReach(since: number | undefined, now: number): MachineReachabilityView {
  return since !== undefined && now - since >= REQUEST_TIMEOUT_MS ? reachabilityView("offline") : CHECKING_REACHABILITY;
}
