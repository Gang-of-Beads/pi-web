import type { NativeServiceBackendKind } from "./servicePlan.js";

/**
 * Where `pi-web uninstall` runs.
 *
 * - `direct`: in this process.
 * - `scheduled-task`: in a transient Windows scheduled task running the same CLI.
 * - `transient-unit`: in a transient systemd user unit running the same CLI.
 * - `one-shot-job`: in a one-shot launchd job running the same CLI.
 * - `detached`: in a child process of its own session, writing to a log file.
 *
 * Run inside the session daemon (a PI WEB terminal, an agent), the uninstall ends with the daemon
 * it stops, before it has removed the daemon's service: on Windows that stop kills the daemon task's
 * whole process tree, the command included; systemd stops every process in the daemon unit's
 * cgroup, and on launchd the daemon's exit closes the terminal, so the command is gone before the
 * other services are removed; on Termux the daemon's exit closes the terminal and hangs up its jobs,
 * leaving the service directory and the wake lock behind. Each placement other than `direct` runs
 * the uninstall outside the daemon's service, and ends when the uninstall does.
 */
export type UninstallPlacement = "direct" | "scheduled-task" | "transient-unit" | "one-shot-job" | "detached";

const placementInsideSessionDaemon: Readonly<Record<NativeServiceBackendKind, UninstallPlacement>> = {
  systemd: "transient-unit",
  launchd: "one-shot-job",
  termux: "detached",
  windows: "scheduled-task",
};

export function uninstallPlacement(backend: NativeServiceBackendKind, hostingServiceId: string | undefined): UninstallPlacement {
  return hostingServiceId === "sessiond" ? placementInsideSessionDaemon[backend] : "direct";
}

export const uninstallTransientUnitName = "pi-web-uninstall.service";

export const uninstallOneShotJobLabel = "com.pi-web.uninstall";

/**
 * `systemd-run` arguments that start `command` as a transient user service appending its output
 * to `logPath`. `--collect` unloads the unit when the command ends, whether it succeeded or failed,
 * so no unit outlives the uninstall. The user manager's environment replaces the caller's, so the
 * caller's `PATH` travels along: the uninstall needs `systemctl` on it.
 */
export function uninstallTransientUnitArgs(command: readonly string[], logPath: string, path: string | undefined): string[] {
  return [
    "--user",
    "--collect",
    `--unit=${uninstallTransientUnitName}`,
    `--property=StandardOutput=append:${logPath}`,
    `--property=StandardError=append:${logPath}`,
    ...(path === undefined ? [] : [`--setenv=PATH=${path}`]),
    "--",
    ...command,
  ];
}

/**
 * The one-shot job's program: a shell that runs `command`, then boots its own job out of launchd
 * (`jobTarget`, passed as the shell's `$0`), so no job outlives the uninstall.
 */
export function uninstallOneShotJobArguments(command: readonly string[], jobTarget: string): string[] {
  return ["/bin/sh", "-c", "\"$@\"; launchctl bootout \"$0\"", jobTarget, ...command];
}
