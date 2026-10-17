import type { NativeServiceBackendKind } from "./servicePlan.js";

/**
 * Where `pi-web uninstall` runs.
 *
 * - `direct`: in this process.
 * - `handed-off`: in a transient Windows scheduled task running the same CLI.
 * - `detached`: in a child process of its own session, writing to a log file.
 *
 * Run inside the session daemon (a PI WEB terminal, an agent), the uninstall ends with the daemon
 * it stops, before it has removed the daemon's service: on Windows that stop kills the daemon task's
 * whole process tree, the command included; on Termux the daemon's exit closes the terminal and
 * hangs up its jobs, leaving the service directory and the wake lock behind. systemd and launchd run
 * it here, as they always have.
 */
export type UninstallPlacement = "direct" | "handed-off" | "detached";

const placementInsideSessionDaemon: Readonly<Record<NativeServiceBackendKind, UninstallPlacement>> = {
  systemd: "direct",
  launchd: "direct",
  termux: "detached",
  windows: "handed-off",
};

export function uninstallPlacement(backend: NativeServiceBackendKind, hostingServiceId: string | undefined): UninstallPlacement {
  return hostingServiceId === "sessiond" ? placementInsideSessionDaemon[backend] : "direct";
}
