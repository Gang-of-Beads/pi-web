import type { NativeServiceBackendKind } from "./servicePlan.js";
import { isTermuxEnvironment } from "./termuxServices.js";

/**
 * Which per-user service manager owns PI WEB's services on this host. Termux
 * is Linux without systemd, recognized by its own markers rather than by
 * systemd being absent; its Node.js reports the `android` platform.
 */
export function nativeServiceBackendKind(
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>>,
): NativeServiceBackendKind | undefined {
  if ((platform === "android" || platform === "linux") && isTermuxEnvironment(environment)) return "termux";
  if (platform === "linux") return "systemd";
  if (platform === "darwin") return "launchd";
  return undefined;
}
