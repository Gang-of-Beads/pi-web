import { createHash } from "node:crypto";
import { join } from "node:path";
import { piWebDataDir } from "../../../config.js";

/**
 * The session daemon's local endpoint. POSIX listens on a socket file in the
 * data directory; Windows Node cannot listen on a filesystem path and needs a
 * named pipe, so the pipe name carries a hash of the data directory to keep
 * two instances with different data directories apart. Windows paths are
 * case-insensitive, so the hash is taken over the lower-cased directory.
 */
export function sessiondSocketPath(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  const configured = env["PI_WEB_SESSIOND_SOCKET"];
  if (configured !== undefined) return configured;
  const dataDir = piWebDataDir(env);
  if (platform !== "win32") return join(dataDir, "sessiond.sock");
  const dataDirHash = createHash("sha256").update(dataDir.toLowerCase()).digest("hex").slice(0, 16);
  return `\\\\.\\pipe\\pi-web-sessiond-${dataDirHash}`;
}

/**
 * Whether a socket path names a Windows named pipe rather than a file: a pipe
 * has no parent directory to create and no stale file to remove, and the
 * system removes it when its listener closes.
 */
export function isWindowsNamedPipePath(path: string): boolean {
  return /^\\\\[.?]\\pipe\\/iu.test(path);
}

/**
 * Human description of the daemon endpoint: the TCP address when a port is
 * configured, otherwise the socket path. Mirrors the listener selection in
 * the session daemon startup.
 */
export function sessiondEndpointDescription(env: NodeJS.ProcessEnv = process.env): string {
  const port = env["PI_WEB_SESSIOND_PORT"];
  if (port !== undefined && port !== "") return `${env["PI_WEB_SESSIOND_HOST"] ?? "127.0.0.1"}:${port}`;
  return sessiondSocketPath(env);
}

export function sessiondHttpUrl(): string | undefined {
  return process.env["PI_WEB_SESSIOND_URL"];
}
