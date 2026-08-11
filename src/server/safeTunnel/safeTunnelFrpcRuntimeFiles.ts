import { randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { rootCertificates } from "node:tls";
import { redactSafeTunnelDiagnostic } from "./safeTunnelDiagnostics.js";
import { defaultSafeTunnelStatePath } from "./safeTunnelState.js";

export const safeTunnelFrpcRuntimeDirectoryMode = 0o700;
export const safeTunnelFrpcConfigFileMode = 0o600;
export const safeTunnelFrpcLogFileMode = 0o600;
export const safeTunnelFrpcTrustedCaFileMode = 0o600;
export const safeTunnelFrpcConfigFileName = "frpc.toml";
export const safeTunnelFrpcLogFileName = "frpc.log";
export const safeTunnelFrpcTrustedCaFileName = "frps-roots.pem";
export const safeTunnelFrpcLogTailCharacters = 12_000;

export interface SafeTunnelFrpcRuntimeFileStatus {
  readonly configExists: boolean;
  readonly configError?: string;
  readonly logError?: string;
  readonly logExists: boolean;
  readonly logTail?: string;
}

export interface SafeTunnelFrpcRuntimeFiles {
  readonly configPath: string;
  readonly logPath: string;
  readonly trustedCaPath: string;
  appendLog(chunk: string): void;
  flushLog(): Promise<void>;
  registerLogRedactionValues(values: readonly string[]): void;
  removeConfig(): Promise<void>;
  resetLog(header: string): Promise<void>;
  status(): Promise<SafeTunnelFrpcRuntimeFileStatus>;
  writeConfig(contents: string): Promise<void>;
}

export interface FileSafeTunnelFrpcRuntimeFilesOptions {
  readonly configPath?: string;
  readonly logPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly statePath?: string;
  readonly trustedCaPath?: string;
  readonly trustedCaPem?: string;
}

/** Owns generated TOML, relay trust roots, and the local log beneath PI WEB data. */
export class FileSafeTunnelFrpcRuntimeFiles implements SafeTunnelFrpcRuntimeFiles {
  readonly configPath: string;
  readonly logPath: string;
  readonly trustedCaPath: string;
  private currentProcessOwnsLog = false;
  private lastLogError: string | undefined;
  private readonly logRedactionValues = new Set<string>();
  private logWriteTail: Promise<void> = Promise.resolve();
  private readonly platform: NodeJS.Platform;
  private readonly trustedCaPem: string;

  constructor(options: FileSafeTunnelFrpcRuntimeFilesOptions = {}) {
    const defaultDirectory = dirname(options.statePath ?? defaultSafeTunnelStatePath());
    this.configPath = options.configPath ?? join(defaultDirectory, safeTunnelFrpcConfigFileName);
    this.logPath = options.logPath ?? join(defaultDirectory, safeTunnelFrpcLogFileName);
    this.trustedCaPath = options.trustedCaPath
      ?? join(dirname(this.configPath), safeTunnelFrpcTrustedCaFileName);
    this.platform = options.platform ?? process.platform;
    this.trustedCaPem = requireTrustedCaPem(
      options.trustedCaPem ?? `${rootCertificates.join("\n")}\n`,
    );
  }

  async writeConfig(contents: string): Promise<void> {
    try {
      await this.writePrivateFile(
        this.trustedCaPath,
        this.trustedCaPem,
        safeTunnelFrpcTrustedCaFileMode,
      );
      await this.writePrivateFile(this.configPath, contents, safeTunnelFrpcConfigFileMode);
    } catch (error: unknown) {
      await rm(this.trustedCaPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async removeConfig(): Promise<void> {
    const removals = await Promise.allSettled([
      rm(this.configPath, { force: true }),
      rm(this.trustedCaPath, { force: true }),
    ]);
    const failed = removals.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failed !== undefined) throw failed.reason;
  }

  async resetLog(header: string): Promise<void> {
    await this.flushLog();
    this.currentProcessOwnsLog = false;
    this.logRedactionValues.clear();
    try {
      await this.ensurePrivateDirectory(dirname(this.logPath));
      await writeFile(this.logPath, header, {
        encoding: "utf8",
        mode: safeTunnelFrpcLogFileMode,
      });
      await restrictMode(this.logPath, safeTunnelFrpcLogFileMode, this.platform);
      this.currentProcessOwnsLog = true;
      this.lastLogError = undefined;
    } catch {
      this.lastLogError = "Unable to initialize the private frpc log.";
    }
  }

  appendLog(chunk: string): void {
    if (chunk === "") return;
    this.logWriteTail = this.logWriteTail.then(async () => {
      try {
        await this.ensurePrivateDirectory(dirname(this.logPath));
        await appendFile(this.logPath, chunk, {
          encoding: "utf8",
          mode: safeTunnelFrpcLogFileMode,
        });
        await restrictMode(this.logPath, safeTunnelFrpcLogFileMode, this.platform);
      } catch {
        this.lastLogError = "Unable to write the private frpc log.";
      }
    });
  }

  async flushLog(): Promise<void> {
    await this.logWriteTail;
  }

  registerLogRedactionValues(values: readonly string[]): void {
    for (const value of values) {
      if (value !== "") this.logRedactionValues.add(value);
    }
  }

  async status(): Promise<SafeTunnelFrpcRuntimeFileStatus> {
    await this.flushLog();
    const config = await privateFileExists(this.configPath);
    const log = await privateFileExists(this.logPath);
    let logTail: string | undefined;
    let logError = this.lastLogError ?? log.error;

    if (log.exists && this.currentProcessOwnsLog) {
      try {
        const contents = await readFile(this.logPath, "utf8");
        logTail = tailText(
          redactSafeTunnelDiagnostic(contents, [...this.logRedactionValues]),
          safeTunnelFrpcLogTailCharacters,
        );
      } catch {
        logError = "Unable to read the private frpc log.";
      }
    }

    return {
      configExists: config.exists,
      ...(config.error === undefined ? {} : { configError: config.error }),
      ...(logError === undefined ? {} : { logError }),
      logExists: log.exists,
      ...(logTail === undefined || logTail === "" ? {} : { logTail }),
    };
  }

  private async writePrivateFile(
    path: string,
    contents: string,
    mode: number,
  ): Promise<void> {
    await this.ensurePrivateDirectory(dirname(path));
    const tempPath = `${path}.${process.pid.toString()}-${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(tempPath, "wx", mode);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await restrictMode(tempPath, mode, this.platform);
      await rename(tempPath, path);
      await restrictMode(path, mode, this.platform);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  private async ensurePrivateDirectory(directory: string): Promise<void> {
    await mkdir(directory, {
      mode: safeTunnelFrpcRuntimeDirectoryMode,
      recursive: true,
    });
    await restrictMode(directory, safeTunnelFrpcRuntimeDirectoryMode, this.platform);
  }
}

export function safeTunnelFrpcTrustedCaPath(statePath: string): string {
  return join(dirname(statePath), safeTunnelFrpcTrustedCaFileName);
}

async function privateFileExists(path: string): Promise<{
  readonly error?: string;
  readonly exists: boolean;
}> {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile()) {
      return { error: "Safe Tunnel runtime path is not a regular file.", exists: false };
    }
    return { exists: true };
  } catch (error: unknown) {
    if (isNodeErrorWithCode(error, "ENOENT")) return { exists: false };
    return { error: "Unable to inspect a Safe Tunnel runtime file.", exists: false };
  }
}

async function restrictMode(
  path: string,
  mode: number,
  platform: NodeJS.Platform,
): Promise<void> {
  if (platform === "win32") return;
  await chmod(path, mode);
}

function requireTrustedCaPem(value: string): string {
  if (value.trim() === ""
    || !value.includes("-----BEGIN CERTIFICATE-----")
    || !value.includes("-----END CERTIFICATE-----")) {
    throw new Error("Safe Tunnel requires a non-empty PI WEB-owned CA certificate bundle.");
  }
  return value.endsWith("\n") ? value : `${value}\n`;
}

function tailText(contents: string, maxCharacters: number): string {
  return contents.length <= maxCharacters
    ? contents
    : contents.slice(contents.length - maxCharacters);
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
