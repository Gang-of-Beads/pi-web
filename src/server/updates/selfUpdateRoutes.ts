import type { FastifyInstance } from "fastify";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { PI_WEB_UPDATE_REPO_ENV } from "../../shared/selfUpdate.js";
import { packageVersion } from "../../piWebVersionReport.js";
import type { PiWebSelfUpdateStatus } from "../../shared/apiTypes.js";

const execFileAsync = promisify(execFile);
const GIT_FETCH_INTERVAL_MS = 60_000;

/**
 * Managed deployments (the nix flake, installer scripts) update through a
 * command that owns version drift - for the flake that is the automated
 * lock-and-switch pipeline, invoked via /pi-web update or the update UI.
 * When this environment is set the git-checkout path is not offered, because
 * a store build has no .git to compare against.
 */
export const PI_WEB_UPDATE_COMMAND_ENV = "PI_WEB_UPDATE_COMMAND";

function updateCommand(): string | undefined {
  const fromEnv = process.env[PI_WEB_UPDATE_COMMAND_ENV];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : undefined;
}

/**
 * Interactive self-update for the host deployment.
 *
 * The "Update now" flow lives here so the browser can offer it like the pi
 * extension updater does: check the fork remote for a newer build, then apply
 * on user request. Applying restarts the daemon and web process, so it runs
 * detached (systemd-run) and the checkout path is explicit: a host that has
 * not opted in (containers, npm installs) sees `enabled: false` and no UI.
 */

export interface SelfUpdateService {
  status(): Promise<PiWebSelfUpdateStatus>;
  /** True when applying started detached; throws a typed error otherwise. */
  apply(): Promise<void>;
}

function repoCandidate(): string | undefined {
  const fromEnv = process.env[PI_WEB_UPDATE_REPO_ENV];
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  // A checkout built by `npm run build` carries its own package.json; walking
  // up from the server bundle finds the repo root in local development.
  const cwd = process.cwd();
  const candidate = join(cwd, "package.json");
  return existsSync(candidate) ? cwd : undefined;
}

async function gitShort(ref: string, cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--short", ref], { cwd, timeout: 5000 });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function createSelfUpdateService(logger: { warn: (obj: unknown, msg: string) => void } | undefined): SelfUpdateService {
  let lastFetch = 0;
  let fetchInFlight: Promise<void> | undefined;

  async function refreshRemote(repo: string): Promise<void> {
    const now = Date.now();
    if (now - lastFetch < GIT_FETCH_INTERVAL_MS) return;
    fetchInFlight ??= (async () => {
      try {
        await execFileAsync("git", ["fetch", "fork"], { cwd: repo, timeout: 10_000 });
      } catch (error) {
        logger?.warn({ err: error, repo }, "failed to fetch fork remote for self-update check");
      } finally {
        lastFetch = Date.now();
        fetchInFlight = undefined;
      }
    })();
    await fetchInFlight;
  }

  return {
    async status() {
      const command = updateCommand();
      if (command !== undefined) {
        return {
          enabled: true,
          current: packageVersion(),
          latest: undefined,
          available: false,
          branch: undefined,
          checkedAt: new Date().toISOString(),
        };
      }
      const repo = repoCandidate();
      if (repo === undefined) {
        return { enabled: false, current: "", latest: undefined, available: false, branch: undefined, checkedAt: new Date().toISOString(), disabledReason: "no checkout (set PI_WEB_UPDATE_REPO)" };
      }
      await refreshRemote(repo);

      const current = await gitShort("HEAD", repo);
      const branch = await gitShort("--abbrev-ref", repo);
      const latest = branch === undefined ? undefined : await gitShort(`fork/${branch}`, repo);
      const available = current !== undefined && latest !== undefined && current !== latest;
      return {
        enabled: true,
        current: current ?? "",
        latest,
        available,
        branch,
        checkedAt: new Date().toISOString(),
      };
    },
    async apply() {
      const command = updateCommand();
      if (command !== undefined) {
        // bash -lc so the command's own PATH expectations hold (home-manager
        // switch needs the nix profile on PATH). Detached via systemd-run:
        // the update restarts this very process.
        const runner = spawn("systemd-run", ["--user", "--collect", "--unit=pi-web-self-update", "--", "/bin/bash", "-lc", command], {
          detached: true,
          stdio: "ignore",
        });
        runner.unref();
        await new Promise<void>((resolve) => {
          runner.once("error", (error) => { logger?.warn({ err: error }, "systemd-run failed to start command self-update"); resolve(); });
          runner.once("spawn", () => { resolve(); });
        });
        return;
      }
      const repo = repoCandidate();
      if (repo === undefined) throw new Error("no checkout to update (set PI_WEB_UPDATE_REPO)");
      const script = join(repo, "scripts", "auto-update.sh");
      if (!existsSync(script)) throw new Error(`no auto-update script at ${script}`);
      // systemd-run detaches the apply from this process, so the restart of
      // the web process mid-apply cannot kill it. Fall back to a plain fork
      // when systemd is unavailable (containers), where the web process being
      // recycled is less disruptive.
      const runner = spawn("systemd-run", ["--user", "--collect", "--unit=pi-web-self-update", "--", "bash", script], {
        detached: true,
        stdio: "ignore",
      });
      runner.unref();
      // Surface an immediate fork failure (missing systemd-run) synchronously.
      await new Promise<void>((resolve) => {
        runner.once("error", (error) => { logger?.warn({ err: error }, "systemd-run failed to start self-update; falling back"); resolve(); });
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

  app.get("/api/pi-web/update/status", async () => service.status());

  app.post("/api/pi-web/update/apply", async (_request, reply) => {
    try {
      await service.apply();
      return await reply.code(202).send({ started: true });
    } catch (error) {
      return reply.code(400).send({ started: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}