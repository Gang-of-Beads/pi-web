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
import { defaultSafeTunnelStatePath } from "./safeTunnelState.js";

export const safeTunnelFrpcRuntimeDirectoryMode = 0o700;
export const safeTunnelFrpcConfigFileMode = 0o600;
export const safeTunnelFrpcLogFileMode = 0o600;
export const safeTunnelFrpcConfigFileName = "frpc.toml";
export const safeTunnelFrpcLogFileName = "frpc.log";
export const safeTunnelFrpcLogTailCharacters = 12_000;

const ansiEscapePattern = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "gu",
);

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
  appendLog(chunk: string): void;
  flushLog(): Promise<void>;
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
}

/** Owns private generated TOML plus the local diagnostic log beneath PI WEB data. */
export class FileSafeTunnelFrpcRuntimeFiles implements SafeTunnelFrpcRuntimeFiles {
  readonly configPath: string;
  readonly logPath: string;
  private lastLogError: string | undefined;
  private logWriteTail: Promise<void> = Promise.resolve();
  private readonly platform: NodeJS.Platform;

  constructor(options: FileSafeTunnelFrpcRuntimeFilesOptions = {}) {
    const defaultDirectory = dirname(options.statePath ?? defaultSafeTunnelStatePath());
    this.configPath = options.configPath ?? join(defaultDirectory, safeTunnelFrpcConfigFileName);
    this.logPath = options.logPath ?? join(defaultDirectory, safeTunnelFrpcLogFileName);
    this.platform = options.platform ?? process.platform;
  }

  async writeConfig(contents: string): Promise<void> {
    const directory = dirname(this.configPath);
    await this.ensurePrivateDirectory(directory);
    const tempPath = `${this.configPath}.${process.pid.toString()}-${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      handle = await open(tempPath, "wx", safeTunnelFrpcConfigFileMode);
      await handle.writeFile(contents, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await restrictMode(tempPath, safeTunnelFrpcConfigFileMode, this.platform);
      await rename(tempPath, this.configPath);
      await restrictMode(this.configPath, safeTunnelFrpcConfigFileMode, this.platform);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(tempPath, { force: true }).catch(() => undefined);
    }
  }

  async removeConfig(): Promise<void> {
    await rm(this.configPath, { force: true });
  }

  async resetLog(header: string): Promise<void> {
    await this.flushLog();
    try {
      await this.ensurePrivateDirectory(dirname(this.logPath));
      await writeFile(this.logPath, header, {
        encoding: "utf8",
        mode: safeTunnelFrpcLogFileMode,
      });
      await restrictMode(this.logPath, safeTunnelFrpcLogFileMode, this.platform);
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

  async status(): Promise<SafeTunnelFrpcRuntimeFileStatus> {
    await this.flushLog();
    const config = await privateFileExists(this.configPath);
    const log = await privateFileExists(this.logPath);
    let logTail: string | undefined;
    let logError = this.lastLogError ?? log.error;

    if (log.exists) {
      try {
        const contents = await readFile(this.logPath, "utf8");
        logTail = tailText(
          contents.replace(ansiEscapePattern, ""),
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

  private async ensurePrivateDirectory(directory: string): Promise<void> {
    await mkdir(directory, {
      mode: safeTunnelFrpcRuntimeDirectoryMode,
      recursive: true,
    });
    await restrictMode(directory, safeTunnelFrpcRuntimeDirectoryMode, this.platform);
  }
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

function tailText(contents: string, maxCharacters: number): string {
  return contents.length <= maxCharacters
    ? contents
    : contents.slice(contents.length - maxCharacters);
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
