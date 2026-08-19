import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";

/**
 * Interactive restart for the host deployment.
 *
 * The web and sessiond processes are owned by systemd user units; restarting
 * them recycles the very process serving this request, so the restart runs
 * detached via `systemd-run --user --collect` and the endpoint replies 202
 * before the recycle lands. Deployments without systemd (containers, npm
 * installs) report `enabled: false` and the client hides the affordance.
 */

export interface RestartService {
  /** Whether a detached restart can be started on this host. */
  restartSupported(): boolean;
  /** Start a detached restart; throws a typed error when unsupported. */
  restart(): Promise<void>;
}

function systemdRunnerAvailable(): boolean {
  // A Docker deployment has no systemd user session, and the container image
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
      return systemdRunnerAvailable();
    },
    async restart(): Promise<void> {
      if (!systemdRunnerAvailable()) throw new Error("Detached restart is unavailable on this host (no systemd user session)");
      const runner = spawn("systemd-run", ["--user", "--collect", "--unit=pi-web-restart", "--", "systemctl", "--user", "restart", "pi-web-sessiond", "pi-web"], {
        detached: true,
        stdio: "ignore",
      });
      runner.unref();
      // Surface an immediate fork failure (missing systemd-run) synchronously.
      await new Promise<void>((resolve) => {
        runner.once("error", (error) => { logger?.warn({ err: error }, "systemd-run failed to start restart"); resolve(); });
        runner.once("spawn", () => { resolve(); });
      });
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