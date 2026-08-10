import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { gunzipSync } from "node:zlib";
import {
  findSafeTunnelFrpcArtifact,
  findSafeTunnelFrpcRelease,
  safeTunnelFrpcManifest,
  type SafeTunnelFrpcArtifact,
  type SafeTunnelFrpcManifest,
  type SafeTunnelFrpcRelease,
} from "./safeTunnelFrpcManifest.js";
import { defaultSafeTunnelStatePath } from "./safeTunnelState.js";

const safeTunnelFrpcDirectoryMode = 0o700;
const safeTunnelFrpcExecutableMode = 0o700;
const maximumArchiveBytes = 64 * 1024 * 1024;
const defaultMaximumDownloadBytes = maximumArchiveBytes;
const maximumExpandedArchiveBytes = 128 * 1024 * 1024;
const maximumExecutableBytes = 64 * 1024 * 1024;
const defaultDownloadTimeoutMs = 60_000;
const tarBlockSize = 512;
const sha256Pattern = /^[a-f0-9]{64}$/u;
const safePathSegmentPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export type SafeTunnelFrpcAcquisitionErrorCode =
  | "checksum_mismatch"
  | "download_failed"
  | "download_too_large"
  | "install_failed"
  | "invalid_archive"
  | "invalid_manifest"
  | "unsupported_platform";

export class SafeTunnelFrpcAcquisitionError extends Error {
  constructor(readonly code: SafeTunnelFrpcAcquisitionErrorCode) {
    super(safeTunnelFrpcErrorMessage(code));
    this.name = "SafeTunnelFrpcAcquisitionError";
  }
}

export interface SafeTunnelManagedFrpc {
  readonly path: string;
  readonly version: string;
  readonly desiredVersion: string;
  readonly platform: NodeJS.Platform;
  readonly architecture: NodeJS.Architecture;
  readonly source: "existing" | "fallback" | "installed";
  readonly updateErrorCode?: SafeTunnelFrpcAcquisitionErrorCode;
}

export interface SafeTunnelManagedFrpcProvider {
  ensureManagedFrpc(): Promise<SafeTunnelManagedFrpc>;
}

export interface SafeTunnelFrpcArtifactSource {
  download(artifact: SafeTunnelFrpcArtifact): Promise<Uint8Array>;
}

export type SafeTunnelFrpcFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpSafeTunnelFrpcArtifactSourceOptions {
  readonly fetch?: SafeTunnelFrpcFetch;
  readonly maximumDownloadBytes?: number;
  readonly timeoutMs?: number;
}

/** Concrete bounded transport for pinned artifacts; it retains no URL, body, or Fetch cause in errors. */
export class HttpSafeTunnelFrpcArtifactSource implements SafeTunnelFrpcArtifactSource {
  private readonly fetch: SafeTunnelFrpcFetch;
  private readonly maximumDownloadBytes: number;
  private readonly timeoutMs: number;

  constructor(options: HttpSafeTunnelFrpcArtifactSourceOptions = {}) {
    this.fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.maximumDownloadBytes = positiveInteger(
      options.maximumDownloadBytes ?? defaultMaximumDownloadBytes,
    );
    this.timeoutMs = positiveInteger(options.timeoutMs ?? defaultDownloadTimeoutMs);
  }

  async download(artifact: SafeTunnelFrpcArtifact): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, this.timeoutMs);
    try {
      let response: Response;
      try {
        response = await this.fetch(artifact.downloadUrl, {
          headers: { accept: "application/octet-stream" },
          redirect: "follow",
          signal: controller.signal,
        });
      } catch {
        throw new SafeTunnelFrpcAcquisitionError("download_failed");
      }

      if (!response.ok || response.body === null) {
        await response.body?.cancel().catch(() => undefined);
        throw new SafeTunnelFrpcAcquisitionError("download_failed");
      }

      try {
        return await readBoundedResponseBody(response, this.maximumDownloadBytes);
      } catch (error: unknown) {
        if (error instanceof SafeTunnelFrpcAcquisitionError) throw error;
        throw new SafeTunnelFrpcAcquisitionError("download_failed");
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export interface SafeTunnelFrpcArchiveExtractor {
  extractExecutable(
    archive: Uint8Array,
    artifact: SafeTunnelFrpcArtifact,
  ): Uint8Array;
}

/** In-memory archive boundary with hard compressed, expanded, and entry-size limits. */
export class TarGzipSafeTunnelFrpcArchiveExtractor implements SafeTunnelFrpcArchiveExtractor {
  extractExecutable(
    archive: Uint8Array,
    artifact: SafeTunnelFrpcArtifact,
  ): Uint8Array {
    if (!isTarGzipArchiveFormat(artifact.archiveFormat)) {
      throw new SafeTunnelFrpcAcquisitionError("invalid_manifest");
    }
    if (archive.byteLength < 1 || archive.byteLength > maximumArchiveBytes) {
      throw new SafeTunnelFrpcAcquisitionError("download_too_large");
    }
    return extractTarGzipEntry(archive, artifact.archiveEntryPath);
  }
}

export interface SafeTunnelFrpcInstallationStore {
  executablePath(
    release: SafeTunnelFrpcRelease,
    artifact: SafeTunnelFrpcArtifact,
  ): string;
  installAtomically(
    release: SafeTunnelFrpcRelease,
    artifact: SafeTunnelFrpcArtifact,
    executable: Uint8Array,
  ): Promise<void>;
  isVerifiedExisting(
    release: SafeTunnelFrpcRelease,
    artifact: SafeTunnelFrpcArtifact,
  ): Promise<boolean>;
}

export interface FileSafeTunnelFrpcInstallationStoreOptions {
  readonly installDirectory?: string;
  readonly platform?: NodeJS.Platform;
}

/** Filesystem boundary for private immutable-version installation and verification. */
export class FileSafeTunnelFrpcInstallationStore implements SafeTunnelFrpcInstallationStore {
  private readonly installDirectory: string;
  private readonly platform: NodeJS.Platform;

  constructor(options: FileSafeTunnelFrpcInstallationStoreOptions = {}) {
    this.installDirectory = options.installDirectory ?? defaultSafeTunnelFrpcInstallDirectory();
    this.platform = options.platform ?? process.platform;
    if (!isAbsolute(this.installDirectory)) {
      throw new SafeTunnelFrpcAcquisitionError("install_failed");
    }
  }

  executablePath(
    release: SafeTunnelFrpcRelease,
    artifact: SafeTunnelFrpcArtifact,
  ): string {
    const target = `${artifact.platform}-${artifact.architecture}`;
    const executableName = artifact.platform === "win32" ? "frpc.exe" : "frpc";
    return join(this.installDirectory, "versions", release.version, target, executableName);
  }

  isVerifiedExisting(
    release: SafeTunnelFrpcRelease,
    artifact: SafeTunnelFrpcArtifact,
  ): Promise<boolean> {
    return this.isVerifiedPath(this.executablePath(release, artifact), artifact);
  }

  async installAtomically(
    release: SafeTunnelFrpcRelease,
    artifact: SafeTunnelFrpcArtifact,
    executable: Uint8Array,
  ): Promise<void> {
    const versionsDirectory = join(this.installDirectory, "versions");
    const releaseDirectory = join(versionsDirectory, release.version);
    const targetDirectory = dirname(this.executablePath(release, artifact));
    const finalPath = this.executablePath(release, artifact);
    const temporaryPath = join(
      targetDirectory,
      `.frpc-${process.pid.toString()}-${randomUUID()}.tmp`,
    );

    try {
      for (const directory of [
        this.installDirectory,
        versionsDirectory,
        releaseDirectory,
        targetDirectory,
      ]) {
        await ensurePrivateInstallDirectory(directory, this.platform);
      }

      const handle = await open(temporaryPath, "wx", safeTunnelFrpcExecutableMode);
      try {
        await handle.writeFile(executable);
        await handle.sync();
      } finally {
        await handle.close().catch(() => undefined);
      }
      if (this.platform !== "win32") await chmod(temporaryPath, safeTunnelFrpcExecutableMode);
      await replaceInstalledFile(temporaryPath, finalPath, artifact, (path, expected) => (
        this.isVerifiedPath(path, expected)
      ));
    } catch (error: unknown) {
      if (error instanceof SafeTunnelFrpcAcquisitionError) throw error;
      throw new SafeTunnelFrpcAcquisitionError("install_failed");
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  private async isVerifiedPath(
    path: string,
    artifact: SafeTunnelFrpcArtifact,
  ): Promise<boolean> {
    try {
      const status = await lstat(path);
      if (!status.isFile() || status.isSymbolicLink() || status.size !== artifact.executableSize) {
        return false;
      }
      const executable = await readFile(path);
      if (!matchesExecutable(executable, artifact)) return false;
      if (this.platform !== "win32") await chmod(path, safeTunnelFrpcExecutableMode);
      return true;
    } catch {
      return false;
    }
  }
}

export interface SafeTunnelFrpcManagerOptions {
  readonly archiveExtractor: SafeTunnelFrpcArchiveExtractor;
  readonly artifactSource: SafeTunnelFrpcArtifactSource;
  readonly installationStore: SafeTunnelFrpcInstallationStore;
  readonly manifest?: SafeTunnelFrpcManifest;
  readonly platform?: NodeJS.Platform;
  readonly architecture?: NodeJS.Architecture;
}

/**
 * Coordinates selection and integrity checks across explicitly injected effect
 * boundaries. Process code consumes only the verified executable path returned here.
 */
export class SafeTunnelFrpcManager implements SafeTunnelManagedFrpcProvider {
  private readonly architecture: NodeJS.Architecture;
  private readonly manifest: SafeTunnelFrpcManifest;
  private readonly platform: NodeJS.Platform;
  private acquisition: Promise<SafeTunnelManagedFrpc> | undefined;

  constructor(private readonly options: SafeTunnelFrpcManagerOptions) {
    this.architecture = options.architecture ?? process.arch;
    this.manifest = options.manifest ?? safeTunnelFrpcManifest;
    this.platform = options.platform ?? process.platform;
    validateManifest(this.manifest);
  }

  ensureManagedFrpc(): Promise<SafeTunnelManagedFrpc> {
    this.acquisition ??= this.ensureOnce().finally(() => {
      this.acquisition = undefined;
    });
    return this.acquisition;
  }

  private async ensureOnce(): Promise<SafeTunnelManagedFrpc> {
    const desiredRelease = findSafeTunnelFrpcRelease(
      this.manifest,
      this.manifest.desiredVersion,
    );
    if (desiredRelease === undefined) {
      throw new SafeTunnelFrpcAcquisitionError("invalid_manifest");
    }

    const desiredArtifact = findSafeTunnelFrpcArtifact(
      desiredRelease,
      this.platform,
      this.architecture,
    );
    if (desiredArtifact === undefined) {
      return this.useFallbackOrThrow(
        new SafeTunnelFrpcAcquisitionError("unsupported_platform"),
      );
    }

    const desiredPath = this.options.installationStore.executablePath(
      desiredRelease,
      desiredArtifact,
    );
    if (await this.options.installationStore.isVerifiedExisting(
      desiredRelease,
      desiredArtifact,
    )) {
      return this.result(desiredRelease.version, desiredPath, "existing");
    }

    try {
      const executable = await this.downloadAndVerify(desiredArtifact);
      await this.options.installationStore.installAtomically(
        desiredRelease,
        desiredArtifact,
        executable,
      );
      if (!await this.options.installationStore.isVerifiedExisting(
        desiredRelease,
        desiredArtifact,
      )) {
        throw new SafeTunnelFrpcAcquisitionError("install_failed");
      }
      return this.result(desiredRelease.version, desiredPath, "installed");
    } catch (error: unknown) {
      return this.useFallbackOrThrow(normalizeAcquisitionError(error));
    }
  }

  private async downloadAndVerify(artifact: SafeTunnelFrpcArtifact): Promise<Uint8Array> {
    let archive: Uint8Array;
    try {
      archive = await this.options.artifactSource.download(artifact);
    } catch (error: unknown) {
      throw normalizeDownloadError(error);
    }

    if (!matchesArchive(archive, artifact)) {
      throw new SafeTunnelFrpcAcquisitionError("checksum_mismatch");
    }
    const executable = this.options.archiveExtractor.extractExecutable(archive, artifact);
    if (!matchesExecutable(executable, artifact)) {
      throw new SafeTunnelFrpcAcquisitionError("checksum_mismatch");
    }
    return executable;
  }

  private async useFallbackOrThrow(
    updateError: SafeTunnelFrpcAcquisitionError,
  ): Promise<SafeTunnelManagedFrpc> {
    for (const release of this.manifest.releases) {
      if (release.version === this.manifest.desiredVersion) continue;
      const artifact = findSafeTunnelFrpcArtifact(
        release,
        this.platform,
        this.architecture,
      );
      if (artifact === undefined) continue;
      const path = this.options.installationStore.executablePath(release, artifact);
      if (!await this.options.installationStore.isVerifiedExisting(release, artifact)) continue;
      return {
        ...this.result(release.version, path, "fallback"),
        updateErrorCode: updateError.code,
      };
    }
    throw updateError;
  }

  private result(
    version: string,
    path: string,
    source: SafeTunnelManagedFrpc["source"],
  ): SafeTunnelManagedFrpc {
    return {
      path,
      version,
      desiredVersion: this.manifest.desiredVersion,
      platform: this.platform,
      architecture: this.architecture,
      source,
    };
  }
}

export function defaultSafeTunnelFrpcInstallDirectory(
  statePath = defaultSafeTunnelStatePath(),
): string {
  return join(dirname(statePath), "frpc");
}

async function readBoundedResponseBody(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/u.test(declaredLength)) {
    const parsedLength = Number.parseInt(declaredLength, 10);
    if (parsedLength > maximumBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new SafeTunnelFrpcAcquisitionError("download_too_large");
    }
  }

  const reader = response.body?.getReader();
  if (reader === undefined) throw new SafeTunnelFrpcAcquisitionError("download_failed");
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SafeTunnelFrpcAcquisitionError("download_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function extractTarGzipEntry(archive: Uint8Array, expectedPath: string): Uint8Array {
  let tar: Buffer;
  try {
    tar = gunzipSync(archive, { maxOutputLength: maximumExpandedArchiveBytes });
  } catch {
    throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
  }

  let offset = 0;
  let executable: Uint8Array | undefined;
  let foundEndMarker = false;
  while (offset + tarBlockSize <= tar.byteLength) {
    const header = tar.subarray(offset, offset + tarBlockSize);
    if (isZeroBlock(header)) {
      foundEndMarker = true;
      break;
    }
    if (!hasValidTarChecksum(header)) {
      throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
    }

    const entryPath = tarEntryPath(header);
    const entrySize = tarOctal(header, 124, 12);
    const typeFlag = header[156] ?? 0;
    const dataStart = offset + tarBlockSize;
    const dataEnd = dataStart + entrySize;
    const paddedSize = Math.ceil(entrySize / tarBlockSize) * tarBlockSize;
    const nextOffset = dataStart + paddedSize;
    if (!Number.isSafeInteger(nextOffset) || dataEnd > tar.byteLength || nextOffset > tar.byteLength) {
      throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
    }

    if (entryPath === expectedPath) {
      if ((typeFlag !== 0 && typeFlag !== 48) || executable !== undefined) {
        throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
      }
      if (entrySize < 1 || entrySize > maximumExecutableBytes) {
        throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
      }
      executable = Uint8Array.from(tar.subarray(dataStart, dataEnd));
    }
    offset = nextOffset;
  }

  if (!foundEndMarker || executable === undefined) {
    throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
  }
  return executable;
}

function hasValidTarChecksum(header: Uint8Array): boolean {
  let sum = 0;
  for (let index = 0; index < header.byteLength; index += 1) {
    sum += index >= 148 && index < 156 ? 32 : (header[index] ?? 0);
  }
  return sum === tarOctal(header, 148, 8);
}

function tarEntryPath(header: Uint8Array): string {
  const name = tarText(header, 0, 100);
  const prefix = tarText(header, 345, 155);
  return prefix === "" ? name : `${prefix}/${name}`;
}

function tarText(
  header: Uint8Array,
  start: number,
  length: number,
): string {
  const field = header.subarray(start, start + length);
  const terminator = field.indexOf(0);
  const bytes = terminator < 0 ? field : field.subarray(0, terminator);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
  }
}

function tarOctal(
  header: Uint8Array,
  start: number,
  length: number,
): number {
  const source = tarText(header, start, length).trim();
  if (source === "") return 0;
  if (!/^[0-7]+$/u.test(source)) {
    throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
  }
  const parsed = Number.parseInt(source, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new SafeTunnelFrpcAcquisitionError("invalid_archive");
  }
  return parsed;
}

function isZeroBlock(block: Uint8Array): boolean {
  return block.every((byte) => byte === 0);
}

function matchesArchive(
  archive: Uint8Array,
  artifact: SafeTunnelFrpcArtifact,
): boolean {
  return matchesPinnedBytes(archive, artifact.archiveSize, artifact.archiveSha256);
}

function matchesExecutable(
  executable: Uint8Array,
  artifact: SafeTunnelFrpcArtifact,
): boolean {
  return matchesPinnedBytes(
    executable,
    artifact.executableSize,
    artifact.executableSha256,
  );
}

function matchesPinnedBytes(
  contents: Uint8Array,
  expectedSize: number,
  expectedSha256: string,
): boolean {
  return contents.byteLength === expectedSize
    && createHash("sha256").update(contents).digest("hex") === expectedSha256;
}

async function ensurePrivateInstallDirectory(
  directory: string,
  platform: NodeJS.Platform,
): Promise<void> {
  await mkdir(directory, { mode: safeTunnelFrpcDirectoryMode, recursive: true });
  const status = await lstat(directory);
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new SafeTunnelFrpcAcquisitionError("install_failed");
  }
  if (platform !== "win32") await chmod(directory, safeTunnelFrpcDirectoryMode);
}

async function replaceInstalledFile(
  temporaryPath: string,
  finalPath: string,
  artifact: SafeTunnelFrpcArtifact,
  isVerifiedExisting: (path: string, artifact: SafeTunnelFrpcArtifact) => Promise<boolean>,
): Promise<void> {
  try {
    await rename(temporaryPath, finalPath);
    return;
  } catch (error: unknown) {
    if (await isVerifiedExisting(finalPath, artifact)) return;
    if (!isReplaceConflict(error)) throw error;
  }

  await rm(finalPath, { force: true });
  await rename(temporaryPath, finalPath);
}

function normalizeDownloadError(error: unknown): SafeTunnelFrpcAcquisitionError {
  return error instanceof SafeTunnelFrpcAcquisitionError
    ? error
    : new SafeTunnelFrpcAcquisitionError("download_failed");
}

function normalizeAcquisitionError(error: unknown): SafeTunnelFrpcAcquisitionError {
  return error instanceof SafeTunnelFrpcAcquisitionError
    ? error
    : new SafeTunnelFrpcAcquisitionError("install_failed");
}

function validateManifest(manifest: SafeTunnelFrpcManifest): void {
  try {
    if (!safePathSegmentPattern.test(manifest.desiredVersion) || manifest.releases.length < 1) {
      throw new Error("invalid manifest");
    }
    const releaseVersions = new Set<string>();
    for (const release of manifest.releases) {
      if (!safePathSegmentPattern.test(release.version) || releaseVersions.has(release.version)) {
        throw new Error("invalid release");
      }
      releaseVersions.add(release.version);
      const targets = new Set<string>();
      for (const artifact of release.artifacts) {
        const target = `${artifact.platform}:${artifact.architecture}`;
        if (targets.has(target)) throw new Error("duplicate target");
        targets.add(target);
        validateArtifact(artifact);
      }
    }
    if (!releaseVersions.has(manifest.desiredVersion)) throw new Error("missing desired release");
  } catch {
    throw new SafeTunnelFrpcAcquisitionError("invalid_manifest");
  }
}

function validateArtifact(artifact: SafeTunnelFrpcArtifact): void {
  if (!safePathSegmentPattern.test(artifact.platform)
    || !safePathSegmentPattern.test(artifact.architecture)) {
    throw new Error("invalid target");
  }
  if (!isTarGzipArchiveFormat(artifact.archiveFormat)) throw new Error("invalid archive format");
  if (!sha256Pattern.test(artifact.archiveSha256)
    || !sha256Pattern.test(artifact.executableSha256)) {
    throw new Error("invalid checksum");
  }
  if (!Number.isSafeInteger(artifact.archiveSize)
    || artifact.archiveSize < 1
    || artifact.archiveSize > maximumArchiveBytes) {
    throw new Error("invalid archive size");
  }
  if (!Number.isSafeInteger(artifact.executableSize)
    || artifact.executableSize < 1
    || artifact.executableSize > maximumExecutableBytes) {
    throw new Error("invalid executable size");
  }
  if (!isSafeArchiveEntryPath(artifact.archiveEntryPath)) {
    throw new Error("invalid archive path");
  }
  const url = new URL(artifact.downloadUrl);
  const loopbackHttp = url.protocol === "http:" && isLoopbackHostname(url.hostname);
  if ((url.protocol !== "https:" && !loopbackHttp)
    || url.username !== ""
    || url.password !== ""
    || url.hash !== "") {
    throw new Error("invalid artifact URL");
  }
}

function isTarGzipArchiveFormat(value: unknown): value is "tar.gz" {
  return value === "tar.gz";
}

function isSafeArchiveEntryPath(path: string): boolean {
  if (path === "" || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    return false;
  }
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "::1" || hostname === "localhost";
}

function positiveInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new SafeTunnelFrpcAcquisitionError("invalid_manifest");
  }
  return value;
}

function isReplaceConflict(error: unknown): boolean {
  return isNodeErrorWithCode(error, "EEXIST")
    || isNodeErrorWithCode(error, "EPERM")
    || isNodeErrorWithCode(error, "ENOTEMPTY");
}

function isNodeErrorWithCode(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

function safeTunnelFrpcErrorMessage(code: SafeTunnelFrpcAcquisitionErrorCode): string {
  switch (code) {
    case "checksum_mismatch":
      return "The downloaded PI WEB Safe Tunnel runtime failed integrity verification.";
    case "download_failed":
      return "PI WEB could not download the managed Safe Tunnel runtime.";
    case "download_too_large":
      return "The downloaded PI WEB Safe Tunnel runtime exceeded its size limit.";
    case "install_failed":
      return "PI WEB could not install the managed Safe Tunnel runtime.";
    case "invalid_archive":
      return "The downloaded PI WEB Safe Tunnel runtime archive is invalid.";
    case "invalid_manifest":
      return "PI WEB's managed Safe Tunnel runtime manifest is invalid.";
    case "unsupported_platform":
      return "PI WEB does not provide a managed Safe Tunnel runtime for this platform and architecture.";
  }
}
