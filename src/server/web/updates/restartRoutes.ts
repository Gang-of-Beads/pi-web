import type { FastifyInstance } from "fastify";
import { userInfo } from "node:os";
import { nativeServiceManagerRefs, type NativeServiceBackendKind } from "../../../nativeServices/servicePlan.js";
import { termuxServiceActionArgs, termuxServiceDirectory } from "../../../nativeServices/termuxServices.js";
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
 * even after this process is gone. A host without a supported service manager
 * refuses instead of claiming a restart started, and so does a launcher that
 * cannot be started.
 * Deployments without a service manager (containers) report `enabled: false`
 * and the client hides the affordance.
 */

export interface RestartService {
  /** Whether a detached restart can be started on this host. */
  restartSupported(): boolean;
  /** Start a detached restart; throws a typed error when unsupported. */
  restart(): Promise<void>;
}

const detachedRestartRunners: Readonly<Record<NativeServiceBackendKind, () => readonly DetachedCommand[]>> = {
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
};

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

export function createRestartService(logger: { warn: (obj: unknown, msg: string) => void } | undefined): RestartService {
  return {
    restartSupported(): boolean {
      return outsideContainer() && currentNativeServiceBackendKind() !== undefined;
    },
    async restart(): Promise<void> {
      if (!outsideContainer()) throw new Error("Detached restart is unavailable inside a container");
      const backend = currentNativeServiceBackendKind();
      if (backend === undefined) throw new Error(`Detached restart is unavailable on this host (${process.platform} has no supported service manager)`);
      await Promise.all(detachedRestartRunners[backend]().map((runner) => startDetachedCommand(runner, (error) => {
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