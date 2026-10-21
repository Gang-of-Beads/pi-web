import { accessSync, constants, existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { basename, dirname, join } from "node:path";
import { effectivePiWebConfig, piWebConfigPath, piWebDataDir, type EffectivePiWebConfig } from "./config.js";
import { sessiondSocketPath } from "./server/shared/sessiondClient/config.js";
import { errorMessage } from "./shared/unknownValues.js";

/**
 * `pi-web doctor`'s checks for a host without a service manager, where PI WEB runs with
 * `pi-web run` or by hand (a container, mostly): the state directories it writes, the session
 * daemon's socket, the init that reaps orphaned processes, and a web/API reachable from outside.
 */

/** `sun_path` holds 108 bytes on Linux, including the terminating NUL. */
const MAX_SOCKET_PATH_BYTES = 107;

/** Inits that reap orphans; PID 1 being one of them is what `docker run --init` and tini provide. */
const reapingInits: ReadonlySet<string> = new Set(["tini", "docker-init", "dumb-init", "catatonit", "s6-svscan", "runit", "systemd", "init"]);

export interface ManualRunReadiness {
  readonly ok: boolean;
  readonly lines: readonly string[];
}

/** A directory PI WEB writes is usable when it is a writable directory, or when the nearest existing parent is, so it can be created. */
function writableDirectoryCheck(label: string, path: string): ManualRunReadiness {
  let existing = path;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  if (!statSync(existing).isDirectory()) {
    return { ok: false, lines: [`✗ ${label} is not a directory: ${existing === path ? path : `${existing} is not a directory, where ${path} would be created`}`] };
  }
  try {
    accessSync(existing, constants.W_OK);
    return { ok: true, lines: [`✓ ${label} writable: ${path}${existing === path ? "" : " (created on first use)"}`] };
  } catch {
    return { ok: false, lines: [`✗ ${label} not writable: ${existing === path ? path : `${existing}, where ${path} would be created`}`] };
  }
}

function listenAndClose(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", (error) => { resolve(error.message); });
    server.listen(path, () => {
      server.close(() => {
        rmSync(path, { force: true });
        resolve(undefined);
      });
    });
  });
}

/**
 * The socket has no authentication, so its directory must be one only this user can write: a shared
 * `/tmp` on a multi-user host would let another user replace it. A container's `/tmp` is its own.
 */
const SOCKET_PATH_ADVICE = "  Set PI_WEB_SESSIOND_SOCKET to a short path on a local filesystem only this user can write, such as $XDG_RUNTIME_DIR/pi-web/sessiond.sock (in a container, /tmp/pi-web/sessiond.sock).";

/**
 * The daemon listens on a Unix socket, which some volumes (SMB/CIFS, some FUSE and desktop bind
 * mounts) cannot hold, and whose path the kernel caps. A probe socket is bound beside it and
 * removed, so a running daemon's socket is never touched.
 */
async function sessiondSocketCheck(env: NodeJS.ProcessEnv): Promise<ManualRunReadiness> {
  const port = env["PI_WEB_SESSIOND_PORT"];
  if (port !== undefined && port !== "") return { ok: true, lines: [`- session daemon listens on TCP port ${port}; no socket to check`] };
  const path = sessiondSocketPath(env);
  const bytes = Buffer.byteLength(path);
  if (bytes > MAX_SOCKET_PATH_BYTES) {
    return { ok: false, lines: [`✗ session daemon socket path is ${String(bytes)} bytes, over the ${String(MAX_SOCKET_PATH_BYTES)} a socket path may have: ${path}`, SOCKET_PATH_ADVICE] };
  }
  const directory = dirname(path);
  if (!existsSync(directory)) return { ok: true, lines: [`? session daemon socket directory ${directory} does not exist yet; the session daemon creates it`] };
  const probePath = join(directory, `.d${String(process.pid)}`);
  if (Buffer.byteLength(probePath) > MAX_SOCKET_PATH_BYTES) {
    return { ok: true, lines: [`? session daemon socket directory ${directory} not probed: a probe socket beside ${basename(path)} would exceed ${String(MAX_SOCKET_PATH_BYTES)} bytes`] };
  }
  const failure = await listenAndClose(probePath);
  if (failure === undefined) return { ok: true, lines: [`✓ session daemon socket directory accepts a socket: ${directory}`] };
  return { ok: false, lines: [`✗ session daemon socket directory does not accept a socket: ${directory} (${failure})`, SOCKET_PATH_ADVICE] };
}

function pid1Lines(): readonly string[] {
  let comm: string;
  try {
    comm = readFileSync("/proc/1/comm", "utf8").trim();
  } catch (error) {
    return [`? PID 1 unknown (/proc/1/comm: ${errorMessage(error)}); make sure it reaps orphaned processes (tini does)`];
  }
  if (reapingInits.has(comm)) return [`✓ PID 1 is ${comm}, which reaps orphaned processes`];
  if (comm === "node" || comm === "pi-web") return [`! PID 1 is ${comm}, which does not reap the orphaned processes agents leave behind; run PI WEB under tini (\`docker run --init\`, or ENTRYPOINT ["tini", "--"])`];
  return [`- PID 1 is ${comm}; make sure it reaps orphaned processes (tini does)`];
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" || host.startsWith("127.");
}

function bindHostLines(host: string): readonly string[] {
  if (isLoopbackHost(host)) return [`✓ web/API listens on ${host}, reachable only from this host or container`];
  return [
    `! web/API listens on ${host}. PI WEB has no login: anyone who reaches this port runs agents and shells as this user.`,
    "  Publish it only behind authentication; see \"Run in a container\" in docs/install.md.",
  ];
}

export async function manualRunReadiness(env: NodeJS.ProcessEnv): Promise<ManualRunReadiness> {
  let config: EffectivePiWebConfig;
  try {
    config = effectivePiWebConfig({ env }).config;
  } catch (error) {
    return { ok: false, lines: [`✗ PI WEB config could not be read: ${errorMessage(error)}`] };
  }
  const checks = [
    writableDirectoryCheck("PI WEB data directory", piWebDataDir(env)),
    writableDirectoryCheck("PI WEB config directory", dirname(piWebConfigPath(env))),
    writableDirectoryCheck("pi agent directory", config.agent.dir),
    await sessiondSocketCheck(env),
  ];
  return {
    ok: checks.every((check) => check.ok),
    lines: [...checks.flatMap((check) => check.lines), ...pid1Lines(), ...bindHostLines(config.host ?? "127.0.0.1")],
  };
}
