import { existsSync } from "node:fs";
import type { NativeServiceBackendKind } from "./servicePlan.js";
import { isTermuxEnvironment } from "./termuxServices.js";

/**
 * Whether systemd is this host's running init, by `sd_booted()`'s definition: the directory
 * exists only while systemd is PID 1. A container, or WSL without systemd enabled, has Linux
 * without it, and there `systemctl --user` can only fail.
 */
export function systemdBooted(): boolean {
  return existsSync("/run/systemd/system");
}

/**
 * Which per-user service manager owns PI WEB's services on this host. Termux
 * is Linux without systemd, recognized by its own markers rather than by
 * systemd being absent; its Node.js reports the `android` platform. Linux
 * without a running systemd has no service manager: it runs PI WEB with
 * `pi-web run` or by hand. Windows uses per-user scheduled tasks.
 */
export function nativeServiceBackendKind(
  platform: NodeJS.Platform,
  environment: Readonly<Record<string, string | undefined>>,
  isSystemdBooted: () => boolean = systemdBooted,
): NativeServiceBackendKind | undefined {
  if ((platform === "android" || platform === "linux") && isTermuxEnvironment(environment)) return "termux";
  if (platform === "linux") return isSystemdBooted() ? "systemd" : undefined;
  if (platform === "darwin") return "launchd";
  if (platform === "win32") return "windows";
  return undefined;
}
