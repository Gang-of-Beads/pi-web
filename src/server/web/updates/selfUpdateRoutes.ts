import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import { configuredUpdateCommand } from "../../shared/deploymentUpdateCommand.js";
import { loadPiWebConfig } from "../../../config.js";

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
 * no systemd-run and whose update command performs the service cutover itself.
 * It runs under `bash -lc` so its own PATH expectations hold (a home-manager
 * switch needs the nix profile on PATH). A command that cannot even be started
 * is refused, so the caller never reports an update that never ran.
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
      const detachViaSystemd = process.platform !== "darwin";
      const runner = detachViaSystemd
        ? spawn("systemd-run", ["--user", "--collect", "--unit=pi-web-self-update", "--", "/bin/bash", "-lc", command], {
            detached: true,
            stdio: "ignore",
          })
        : spawn("/bin/bash", ["-lc", command], { detached: true, stdio: "ignore" });
      runner.unref();
      await new Promise<void>((resolve, reject) => {
        runner.once("error", (error) => {
          logger?.warn({ err: error }, `${detachViaSystemd ? "systemd-run" : "bash"} failed to start command self-update`);
          reject(new Error(`the update command could not be started: ${error.message}`));
        });
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
