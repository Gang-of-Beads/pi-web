import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { configuredUpdateCommand } from "../../shared/deploymentUpdateCommand.js";
import { loadPiWebConfig } from "../../../config.js";

/**
 * Self-update for a deployment that declared its own update command.
 *
 * Only the installer or the reader knows how a machine updates (a nix flake, an
 * installer script, a custom pipeline), so this route runs the configured
 * `updateCommand` and nothing else. A machine without one answers with a clear
 * refusal; a git checkout updates by pulling and restarting. Applying restarts
 * the web process and the session daemon, so the command runs detached.
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

export function createSelfUpdateService(logger: { warn: (obj: unknown, msg: string) => void } | undefined): SelfUpdateService {
  return {
    async apply() {
      const command = updateCommand();
      if (command === undefined) throw new Error("no update command configured (set updateCommand in Settings)");
      // bash -lc so the command's own PATH expectations hold (home-manager
      // switch needs the nix profile on PATH). On Linux the command runs
      // detached via systemd-run: the update restarts this very process.
      // On macOS there is no systemd-run, so fall back to a plain detached
      // bash child, which survives the web process being recycled (the
      // update command itself performs the service cutover).
      const detachViaSystemd = process.platform !== "darwin";
      const runner = detachViaSystemd
        ? spawn("systemd-run", ["--user", "--collect", "--unit=pi-web-self-update", "--", "/bin/bash", "-lc", command], {
            detached: true,
            stdio: "ignore",
          })
        : spawn("/bin/bash", ["-lc", command], { detached: true, stdio: "ignore" });
      runner.unref();
      await new Promise<void>((resolve) => {
        runner.once("error", (error) => { logger?.warn({ err: error }, `${detachViaSystemd ? "systemd-run" : "bash"} failed to start command self-update`); resolve(); });
        runner.once("spawn", () => { resolve(); });
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
