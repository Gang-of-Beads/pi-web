import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { rootCertificates } from "node:tls";
import { defaultSafeTunnelStatePath } from "./safeTunnelState.js";

export const safeTunnelFrpcRuntimeDirectoryMode = 0o700;
export const safeTunnelFrpcConfigFileMode = 0o600;
export const safeTunnelFrpcTrustedCaFileMode = 0o600;
export const safeTunnelFrpcConfigFileName = "frpc.toml";
export const safeTunnelFrpcTrustedCaFileName = "frps-roots.pem";

export interface SafeTunnelFrpcRuntimeFiles {
  readonly configPath: string;
  readonly trustedCaPath: string;
  removeConfig(): Promise<void>;
  writeConfig(contents: string): Promise<void>;
}

export interface FileSafeTunnelFrpcRuntimeFilesOptions {
  readonly configPath?: string;
  readonly platform?: NodeJS.Platform;
  readonly statePath?: string;
  readonly trustedCaPath?: string;
  readonly trustedCaPem?: string;
}

/** Owns generated TOML and relay trust roots beneath the private PI WEB data directory. */
export class FileSafeTunnelFrpcRuntimeFiles implements SafeTunnelFrpcRuntimeFiles {
  readonly configPath: string;
  readonly trustedCaPath: string;
  private readonly platform: NodeJS.Platform;
  private readonly trustedCaPem: string;

  constructor(options: FileSafeTunnelFrpcRuntimeFilesOptions = {}) {
    const defaultDirectory = dirname(options.statePath ?? defaultSafeTunnelStatePath());
    this.configPath = options.configPath ?? join(defaultDirectory, safeTunnelFrpcConfigFileName);
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
