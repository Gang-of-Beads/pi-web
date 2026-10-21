import type { FastifyInstance } from "fastify";
import { configuredUpdateCommand } from "../../shared/deploymentUpdateCommand.js";
import { loadPiWebConfig } from "../../../config.js";
import { supervisedByPiWebRun } from "../../../environment.js";
import type { NativeServiceBackendKind } from "../../../nativeServices/servicePlan.js";
import { currentNativeServiceBackendKind, startDetachedCommand, termuxLoginShell, type DetachedCommand } from "./detachedCommand.js";

/**
 * Self-update for a deployment that declared its own update command.
 *
 * Only the installer or the reader knows how a machine updates (a nix flake, an
 * installer script, a custom pipeline), so this route runs the configured
 * `updateCommand` and nothing else, and a machine without one answers with a
 * clear refusal (a git checkout is updated by whoever runs it: pull and restart,
 * docs/install.md). Applying restarts the web process and the session daemon, so
 * the command runs detached: through systemd-run on Linux, since the update
 * restarts this very process, and as a detached bash child on macOS, which has
 * no systemd-run and whose update command performs the service cutover itself,
 * and on Termux, whose runsv restarts services without killing a detached
 * child. It runs under `bash -lc` so its own PATH expectations hold (a
 * home-manager switch needs the nix profile on PATH). A command that cannot
 * even be started is refused, so the caller never reports an update that never
 * ran. Windows refuses outright: an update there has to stop the services
 * first (they keep node-pty's native module locked), and no runner does that
 * stop, update and start from outside their process trees.
 */

export interface SelfUpdateService {
  /** Resolves when the command started detached; throws when there is nothing to run. */
  apply(): Promise<void>;
}

/** The saved command, else the services' one; a config that cannot be read saves none. */
function updateCommand(): string | undefined {
  try {
    return configuredUpdateCommand(loadPiWebConfig().config.updateCommand);
  } catch {
    return configuredUpdateCommand(undefined);
  }
}

const selfUpdateRunners: Readonly<Record<NativeServiceBackendKind, (command: string) => DetachedCommand>> = {
  systemd: (command) => ({
    command: "systemd-run",
    args: ["--user", "--collect", "--unit=pi-web-self-update", "--", "/bin/bash", "-lc", command],
    launcher: "systemd-run",
  }),
  launchd: (command) => ({ command: "/bin/bash", args: ["-lc", command], launcher: "bash" }),
  termux: (command) => ({ command: termuxLoginShell, args: ["-lc", command], launcher: termuxLoginShell }),
  windows: () => {
    throw new Error("applying an update from the browser is not available on Windows yet; see the Windows section of docs/install.md");
  },
};

/**
 * Under `pi-web run` no service manager owns these processes, even on a host that has one: a detached
 * command's restart would reach the host's service units, not the supervised processes, so the
 * update is refused as Restart is (restartRoutes).
 */
const supervisedUpdateRefusal = "the update command cannot be started detached under `pi-web run`, because no service manager runs these processes; update the image or package it runs from, then restart the container or the `pi-web run` process";

export function createSelfUpdateService(logger: { warn: (obj: unknown, msg: string) => void } | undefined): SelfUpdateService {
  return {
    async apply() {
      const command = updateCommand();
      if (command === undefined) throw new Error("no update command configured (set updateCommand in Settings)");
      if (supervisedByPiWebRun(process.env)) throw new Error(supervisedUpdateRefusal);
      const backend = currentNativeServiceBackendKind();
      if (backend === undefined) throw new Error(`the update command cannot be started detached on ${process.platform}`);
      const runner = selfUpdateRunners[backend](command);
      await startDetachedCommand(runner, (error) => {
        logger?.warn({ err: error }, `${runner.launcher} failed to start command self-update`);
        return new Error(`the update command could not be started: ${error.message}`);
      });
    },
  };
}

export interface SelfUpdateRouteDeps {
  selfUpdate?: SelfUpdateService;
}

export function registerSelfUpdateRoutes(app: FastifyInstance, deps: SelfUpdateRouteDeps = {}): void {
  const service = deps.selfUpdate ?? createSelfUpdateService(app.log);

  app.post("/api/pi-web/update/apply", async (_request, reply) => {
    try {
      await service.apply();
      return await reply.code(202).send({ started: true });
    } catch (error) {
      return reply.code(400).send({ started: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
