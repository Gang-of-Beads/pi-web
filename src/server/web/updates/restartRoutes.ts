import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defaultPiWebDataDir } from "../../../config.js";
import { nativeServiceManagerRefs, type NativeServiceBackendKind } from "../../../nativeServices/servicePlan.js";
import { termuxServiceActionArgs, termuxServiceDirectory } from "../../../nativeServices/termuxServices.js";
import {
  readInstalledWindowsTaskStartMode,
  windowsCliHandOffScript,
  windowsLauncherDirectory,
  windowsPowerShell,
  windowsPowerShellArguments,
  windowsTaskStartModeInUse,
  windowsUserSidFromWhoami,
} from "../../../nativeServices/windowsTaskScheduler.js";
import { errorMessage } from "../../../shared/unknownValues.js";
import { supervisedByPiWebRun } from "../../../environment.js";
import { currentNativeServiceBackendKind, startDetachedCommand, termuxLoginShell, type DetachedCommand } from "./detachedCommand.js";

/**
 * Interactive restart for the host deployment.
 *
 * Restarting the web and sessiond services recycles the very process serving
 * this request, so the restart runs detached and the endpoint replies 202
 * before the recycle lands: through `systemd-run --user --collect` for systemd
 * user units, as detached `launchctl kickstart -k` commands for LaunchAgents,
 * all started before either service stops, and as a detached login shell
 * running `sv restart` for termux-services, whose runsv finishes the restart
 * even after this process is gone. On Windows the restart is handed to the
 * "PI WEB restart (<user>)" scheduled task, the same hand-off `pi-web restart`
 * uses inside PI WEB, because stopping the web task kills its whole process
 * tree: a transient one in log-on mode, the one `pi-web install` registered in
 * at-boot mode. The reply waits until that task is started. A host
 * without a supported service manager refuses instead of claiming a restart
 * started, and so do a Windows host without PI WEB's tasks and a launcher that
 * cannot be started.
 * Deployments without a service manager (containers, Linux without systemd,
 * `pi-web run`) report `enabled: false` and the client hides the affordance.
 */

export interface RestartService {
  /** Whether a detached restart can be started on this host. */
  restartSupported(): boolean;
  /** Start a detached restart; throws a typed error when unsupported. */
  restart(): Promise<void>;
}

const execFileAsync = promisify(execFile);

async function currentWindowsUserSid(): Promise<string> {
  const { stdout } = await execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).catch((error: unknown) => {
    throw new Error(`the restart could not be started: \`whoami /user\` failed: ${errorMessage(error)}`);
  });
  const sid = windowsUserSidFromWhoami(stdout);
  if (sid === undefined) throw new Error("the restart could not be started: `whoami /user` did not report the user's SID");
  return sid;
}

async function windowsRestartHandOff(): Promise<readonly DetachedCommand[]> {
  const userSid = await currentWindowsUserSid();
  const logPath = join(defaultPiWebDataDir(), "logs", "restart.log");
  await mkdir(dirname(logPath), { recursive: true });
  const cliPath = fileURLToPath(new URL("../../../cli.js", import.meta.url));
  const launcherPath = join(windowsLauncherDirectory(process.env, homedir()), nativeServiceManagerRefs.sessiond.windowsLauncherName);
  const startMode = windowsTaskStartModeInUse[readInstalledWindowsTaskStartMode(launcherPath)];
  return [{
    command: windowsPowerShell,
    args: windowsPowerShellArguments(windowsCliHandOffScript({ verb: "restart", cliPath, userName: userInfo().username, userSid, logPath, startMode })),
    launcher: windowsPowerShell,
    start: "handed-off",
  }];
}

const detachedRestartRunners: Readonly<Record<NativeServiceBackendKind, () => readonly DetachedCommand[] | Promise<readonly DetachedCommand[]>>> = {
  systemd: () => [{
    command: "systemd-run",
    args: ["--user", "--collect", "--unit=pi-web-restart", "--", "systemctl", "--user", "restart", "pi-web-sessiond", "pi-web"],
    launcher: "systemd-run",
  }],
  launchd: () => [nativeServiceManagerRefs.web, nativeServiceManagerRefs.sessiond].map((ref) => ({
    command: "launchctl",
    args: ["kickstart", "-k", `gui/${String(userInfo().uid)}/${ref.launchdLabel}`],
    launcher: "launchctl",
  })),
  termux: () => [{
    command: termuxLoginShell,
    args: ["-lc", `sv ${termuxServiceActionArgs("restart", [termuxServiceDirectory(nativeServiceManagerRefs.web), termuxServiceDirectory(nativeServiceManagerRefs.sessiond)]).join(" ")}`],
    launcher: termuxLoginShell,
  }],
  windows: windowsRestartHandOff,
};

/** PI WEB's tasks are installed when a launcher is: without one there is no task the hand-off could restart. */
function windowsServicesInstalled(): boolean {
  const directory = windowsLauncherDirectory(process.env, homedir());
  return Object.values(nativeServiceManagerRefs).some((ref) => existsSync(join(directory, ref.windowsLauncherName)));
}

/** Why this host's service manager cannot restart PI WEB now, or undefined when it can. */
const restartUnavailableReasons: Readonly<Record<NativeServiceBackendKind, () => string | undefined>> = {
  systemd: () => undefined,
  launchd: () => undefined,
  termux: () => undefined,
  windows: () => windowsServicesInstalled() ? undefined : "PI WEB's scheduled tasks are not installed",
};

type RestartAvailability =
  | { kind: "available"; backend: NativeServiceBackendKind }
  | { kind: "unavailable"; reason: string };

function restartAvailability(): RestartAvailability {
  const backend = currentNativeServiceBackendKind();
  if (backend === undefined) return { kind: "unavailable", reason: `${process.platform} has no supported service manager` };
  const reason = restartUnavailableReasons[backend]();
  return reason === undefined ? { kind: "available", backend } : { kind: "unavailable", reason };
}

function outsideContainer(): boolean {
  // A Docker deployment has no user service manager, and the container image
  // does not always set CONTAINER. Reporting "restart started" there was worse
  // than reporting nothing: the caller was told work had begun that could never
  // happen, and a fleet report inherited the same false claim for that machine.
  if (isTruthyEnv("PI_WEB_DOCKER_RUNTIME")) return false;
  return process.env["CONTAINER"] === undefined || process.env["CONTAINER"] === "";
}

function isTruthyEnv(key: string): boolean {
  const value = process.env[key];
  return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Why this deployment's processes are not the host's PI WEB services, or undefined when they are.
 * Under `pi-web run` a service manager may exist, but it does not own these processes, so
 * restarting its services would restart something else.
 */
function deploymentRestartRefusal(): string | undefined {
  if (supervisedByPiWebRun(process.env)) return "Detached restart is unavailable under `pi-web run`; restart the container or the `pi-web run` process";
  if (!outsideContainer()) return "Detached restart is unavailable inside a container";
  return undefined;
}

export function createRestartService(logger: { warn: (obj: unknown, msg: string) => void } | undefined): RestartService {
  return {
    restartSupported(): boolean {
      return deploymentRestartRefusal() === undefined && restartAvailability().kind === "available";
    },
    async restart(): Promise<void> {
      const refusal = deploymentRestartRefusal();
      if (refusal !== undefined) throw new Error(refusal);
      const availability = restartAvailability();
      if (availability.kind === "unavailable") throw new Error(`Detached restart is unavailable on this host (${availability.reason})`);
      const runners = await detachedRestartRunners[availability.backend]();
      await Promise.all(runners.map((runner) => startDetachedCommand(runner, (error) => {
        logger?.warn({ err: error }, `${runner.launcher} failed to start restart`);
        return new Error(`the restart could not be started: ${error.message}`);
      })));
    },
  };
}

export interface RestartRouteDeps {
  restart?: RestartService;
}

export function registerRestartRoutes(app: FastifyInstance, deps: RestartRouteDeps = {}): void {
  const service = deps.restart ?? createRestartService(app.log);

  app.post("/api/pi-web/restart", async (_request, reply) => {
    try {
      await service.restart();
      return await reply.code(202).send({ started: true });
    } catch (error) {
      return reply.code(400).send({ started: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}