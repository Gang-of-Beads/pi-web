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
 *
 * A Docker deployment has no host service manager inside its container, so it uninstalls
 * `direct`, as before the hand-offs existed.
 */
export type UninstallPlacement = "direct" | "scheduled-task" | "transient-unit" | "one-shot-job" | "detached";

const placementInsideSessionDaemon: Readonly<Record<NativeServiceBackendKind, UninstallPlacement>> = {
  systemd: "transient-unit",
  launchd: "one-shot-job",
  termux: "detached",
  windows: "scheduled-task",
};

export function uninstallPlacement(backend: NativeServiceBackendKind, hostingServiceId: string | undefined, dockerDeployment: boolean): UninstallPlacement {
  return hostingServiceId === "sessiond" && !dockerDeployment ? placementInsideSessionDaemon[backend] : "direct";
}

export const uninstallTransientUnitName = "pi-web-uninstall.service";

export const uninstallOneShotJobLabel = "com.pi-web.uninstall";

/** The command a hand-off runs, and where the caller ran it from. */
export interface UninstallHandOffCommand {
  readonly command: readonly string[];
  /**
   * The caller's working directory, against which a checkout's `execArgv` (`--import tsx`)
   * resolves; undefined when the caller's directory no longer exists.
   */
  readonly workingDirectory: string | undefined;
}

/**
 * `systemd-run` arguments that start `command` as a transient user service appending its output
 * to `logPath`. `--collect` unloads the unit when the command ends, whether it succeeded or failed,
 * so no unit outlives the uninstall. The user manager's environment replaces the caller's, so the
 * caller's `PATH` travels along (the uninstall needs `systemctl` on it), and the session marker is
 * cleared in case the manager's environment imported it, which would hand the uninstall off again.
 * The working directory's `-` prefix lets the unit start when that directory is gone. A shell
 * appends the output, because `StandardOutput=append:` needs systemd 240.
 */
export function uninstallTransientUnitArgs(handOff: UninstallHandOffCommand, logPath: string, path: string | undefined): string[] {
  return [
    "--user",
    "--collect",
    `--unit=${uninstallTransientUnitName}`,
    "--setenv=PI_WEB_SESSION=",
    ...(path === undefined ? [] : [`--setenv=PATH=${path}`]),
    ...(handOff.workingDirectory === undefined ? [] : [`--property=WorkingDirectory=-${handOff.workingDirectory}`]),
    "--",
    "/bin/sh",
    "-c",
    "exec \"$@\" >> \"$0\" 2>&1",
    logPath,
    ...handOff.command,
  ];
}

/**
 * The one-shot job's program: a shell that enters the caller's working directory when it still
 * exists, clears the session marker launchd's environment may carry, runs `command`, then boots
 * its own job out of launchd (`jobTarget`, passed as the shell's `$0`), so no job outlives the
 * uninstall. The shell changes directory rather than the plist's `WorkingDirectory`, so a
 * vanished directory leaves the job in `/` instead of failing it.
 */
export function uninstallOneShotJobArguments(handOff: UninstallHandOffCommand, jobTarget: string): string[] {
  return [
    "/bin/sh",
    "-c",
    "cd \"$1\" 2>/dev/null; shift; unset PI_WEB_SESSION; \"$@\"; launchctl bootout \"$0\"",
    jobTarget,
    handOff.workingDirectory ?? "/",
    ...handOff.command,
  ];
}
