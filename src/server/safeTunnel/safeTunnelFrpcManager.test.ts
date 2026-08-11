import { createHash } from "node:crypto";
import { createServer, type RequestListener, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findSafeTunnelFrpcArtifact,
  findSafeTunnelFrpcRelease,
  safeTunnelFrpcManifest,
  type SafeTunnelFrpcArtifact,
  type SafeTunnelFrpcManifest,
  type SafeTunnelFrpcRelease,
} from "./safeTunnelFrpcManifest.js";
import {
  FileSafeTunnelFrpcInstallationStore,
  HttpSafeTunnelFrpcArtifactSource,
  SafeTunnelFrpcAcquisitionError,
  SafeTunnelFrpcManager,
  TarGzipSafeTunnelFrpcArchiveExtractor,
  type SafeTunnelFrpcArtifactSource,
} from "./safeTunnelFrpcManager.js";

let tempDirectory: string;
const servers: Server[] = [];

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "pi-web-managed-frpc-"));
});

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)));
  await rm(tempDirectory, { force: true, recursive: true });
});

describe("pinned Safe Tunnel frpc manifest", () => {
  it("pins independently verified official frp executables for the supported targets", () => {
    const release = findSafeTunnelFrpcRelease(safeTunnelFrpcManifest, "0.69.1");
    if (release === undefined) throw new Error("Pinned frp release is missing");

    expect(safeTunnelFrpcManifest.desiredVersion).toBe("0.69.1");
    expect(release.artifacts).toHaveLength(2);
    expect(findSafeTunnelFrpcArtifact(release, "linux", "arm64")).toEqual({
      platform: "linux",
      architecture: "arm64",
      archiveFormat: "tar.gz",
      archiveSha256: "bbc0c75e896af3f292fb46ba09c844a04fa9b5ea3530c039c7af20637f836355",
      archiveSize: 12_599_774,
      archiveEntryPath: "frp_0.69.1_linux_arm64/frpc",
      downloadUrl: "https://github.com/fatedier/frp/releases/download/v0.69.1/frp_0.69.1_linux_arm64.tar.gz",
      executableSha256: "f93e758ea21099a8ac6b65791d1113e86ccb06bab03cc41575613726e375322d",
      executableSize: 15_007_928,
    });
    expect(findSafeTunnelFrpcArtifact(release, "linux", "x64")).toEqual({
      platform: "linux",
      architecture: "x64",
      archiveFormat: "tar.gz",
      archiveSha256: "7be257b72dbbc60bcb3e0e25a5afd1dfac7b63f897084864d3c956dd3d5674e1",
      archiveSize: 14_189_005,
      archiveEntryPath: "frp_0.69.1_linux_amd64/frpc",
      downloadUrl: "https://github.com/fatedier/frp/releases/download/v0.69.1/frp_0.69.1_linux_amd64.tar.gz",
      executableSha256: "142f447f43fef286acc8da8a6852dda80631db631d604b2e63634b2db4d6848c",
      executableSize: 16_806_072,
    });
  });
});

describe("HttpSafeTunnelFrpcArtifactSource", () => {
  it("downloads bytes within both the transport and pinned-artifact bounds without exposing details", async () => {
    const expected = Buffer.from("fixture archive bytes");
    const baseArtifact = {
      ...artifactFixture("1.0.0", expected).artifact,
      archiveSize: expected.byteLength,
    };
    const requests: { readonly accept: string | undefined; readonly path: string | undefined }[] = [];
    const server = await listen((request, response) => {
      requests.push({ accept: request.headers.accept, path: request.url });
      if (request.url?.startsWith("/failure") === true) {
        response.writeHead(503, { "content-type": "text/plain" });
        response.end("private-provider-response");
        return;
      }
      if (request.url === "/large") {
        response.writeHead(200, { "content-length": "1000" });
        response.end("too large");
        return;
      }
      if (request.url === "/stream-large") {
        response.writeHead(200);
        response.end(Buffer.alloc(1_000));
        return;
      }
      response.writeHead(200, { "content-length": expected.byteLength.toString() });
      response.write(expected.subarray(0, 7));
      response.end(expected.subarray(7));
    });
    const source = new HttpSafeTunnelFrpcArtifactSource({ maximumDownloadBytes: 1_024 });

    await expect(source.download({
      ...baseArtifact,
      downloadUrl: `${server.origin}/artifact`,
    })).resolves.toEqual(Uint8Array.from(expected));
    expect(requests[0]).toEqual({ accept: "application/octet-stream", path: "/artifact" });

    const failureArtifact = {
      ...baseArtifact,
      downloadUrl: `${server.origin}/failure?access_token=private-url-token`,
    };
    const failure = await captureError(source.download(failureArtifact));
    expect(failure).toMatchObject({
      code: "download_failed",
      message: "PI WEB could not download the managed Safe Tunnel runtime.",
    });
    expect(errorDiagnostic(failure)).not.toContain("private-url-token");
    expect(errorDiagnostic(failure)).not.toContain("private-provider-response");

    const declaredLarge = await captureError(source.download({
      ...baseArtifact,
      downloadUrl: `${server.origin}/large`,
    }));
    expect(declaredLarge).toMatchObject({ code: "download_too_large" });

    const streamedLarge = await captureError(source.download({
      ...baseArtifact,
      downloadUrl: `${server.origin}/stream-large`,
    }));
    expect(streamedLarge).toMatchObject({ code: "download_too_large" });
  });

  it("aborts a stalled transport at the configured timeout", async () => {
    vi.useFakeTimers();
    try {
      let observedSignal: AbortSignal | null | undefined;
      const source = new HttpSafeTunnelFrpcArtifactSource({
        fetch: (_input, init) => {
          observedSignal = init?.signal;
          return new Promise<Response>((_resolve, reject) => {
            observedSignal?.addEventListener(
              "abort",
              () => { reject(new Error("private stalled transport")); },
              { once: true },
            );
          });
        },
        timeoutMs: 50,
      });
      const fixture = artifactFixture("1.0.0", Buffer.from("fixture"));
      const assertion = expect(source.download(fixture.artifact)).rejects.toMatchObject({
        code: "download_failed",
        message: "PI WEB could not download the managed Safe Tunnel runtime.",
      });

      await vi.advanceTimersByTimeAsync(50);

      await assertion;
      expect(observedSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("SafeTunnelFrpcManager", () => {
  it("selects, extracts, verifies, and atomically installs a loopback archive fixture", async () => {
    const executable = Buffer.from("#!/bin/sh\necho fixture-frpc\n");
    let requestCount = 0;
    const archivePath = "frp_1.2.3_linux_arm64/frpc";
    const archive = tarGzipFixture([{ path: archivePath, contents: executable }]);
    const server = await listen((_request, response) => {
      requestCount += 1;
      response.writeHead(200, { "content-type": "application/gzip" });
      response.end(archive);
    });
    const fixture = artifactFixture("1.2.3", executable, `${server.origin}/frp.tar.gz`, {
      archive,
      archiveEntryPath: archivePath,
    });
    const manager = managerFor(fixture.manifest, new HttpSafeTunnelFrpcArtifactSource());

    const installed = await manager.ensureManagedFrpc();

    expect(installed).toMatchObject({
      version: "1.2.3",
      desiredVersion: "1.2.3",
      platform: "linux",
      architecture: "arm64",
      source: "installed",
    });
    expect(installed.path).toBe(join(
      tempDirectory,
      "safe-tunnel",
      "frpc",
      "versions",
      "1.2.3",
      "linux-arm64",
      "frpc",
    ));
    expect(await readFile(installed.path)).toEqual(executable);
    if (process.platform !== "win32") {
      expect((await stat(installed.path)).mode & 0o777).toBe(0o700);
      expect((await stat(dirname(installed.path))).mode & 0o777).toBe(0o700);
    }
    expect(await temporaryInstallFiles(join(tempDirectory, "safe-tunnel", "frpc"))).toEqual([]);

    await expect(manager.ensureManagedFrpc()).resolves.toMatchObject({ source: "existing" });
    expect(requestCount).toBe(1);
  });

  it("coalesces concurrent acquisition through the same manager", async () => {
    const fixture = artifactFixture("1.0.0", Buffer.from("verified frpc"));
    const source = new FixtureArtifactSource([
      [fixture.artifact.downloadUrl, fixture.archive],
    ]);
    const manager = managerFor(fixture.manifest, source);

    const first = manager.ensureManagedFrpc();
    const second = manager.ensureManagedFrpc();

    expect(second).toBe(first);
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ source: "installed" }),
      expect.objectContaining({ source: "installed" }),
    ]);
    expect(source.calls).toEqual([fixture.artifact.downloadUrl]);
  });

  it.skipIf(process.platform === "win32")(
    "rejects a symlinked managed-install directory before writing through it",
    async () => {
      const fixture = artifactFixture("1.0.0", Buffer.from("verified frpc"));
      const source = new FixtureArtifactSource([
        [fixture.artifact.downloadUrl, fixture.archive],
      ]);
      const installDirectory = join(tempDirectory, "safe-tunnel", "frpc");
      const outsideDirectory = join(tempDirectory, "outside");
      await mkdir(dirname(installDirectory), { recursive: true });
      await mkdir(outsideDirectory);
      await symlink(outsideDirectory, installDirectory, "dir");

      await expect(managerFor(fixture.manifest, source).ensureManagedFrpc())
        .rejects.toMatchObject({ code: "install_failed" });
      await expect(readdir(outsideDirectory)).resolves.toEqual([]);
    },
  );

  it("installs a desired-version upgrade while preserving the verified prior version", async () => {
    const versionOne = artifactFixture("1.0.0", Buffer.from("verified frpc version one"));
    const firstSource = new FixtureArtifactSource([[versionOne.artifact.downloadUrl, versionOne.archive]]);
    const first = await managerFor(versionOne.manifest, firstSource).ensureManagedFrpc();

    const versionTwo = artifactFixture("2.0.0", Buffer.from("verified frpc version two"));
    const upgradeManifest: SafeTunnelFrpcManifest = {
      desiredVersion: "2.0.0",
      releases: [versionTwo.release, versionOne.release],
    };
    const upgradeSource = new FixtureArtifactSource([[versionTwo.artifact.downloadUrl, versionTwo.archive]]);

    const upgraded = await managerFor(upgradeManifest, upgradeSource).ensureManagedFrpc();

    expect(upgraded).toMatchObject({ version: "2.0.0", source: "installed" });
    expect(upgraded.path).not.toBe(first.path);
    expect(await readFile(upgraded.path)).toEqual(Buffer.from("verified frpc version two"));
    expect(await readFile(first.path)).toEqual(Buffer.from("verified frpc version one"));
    expect(await temporaryInstallFiles(join(tempDirectory, "safe-tunnel", "frpc"))).toEqual([]);

    const noDownloadSource = new FixtureArtifactSource([]);
    await expect(managerFor(upgradeManifest, noDownloadSource).ensureManagedFrpc())
      .resolves.toMatchObject({ version: "2.0.0", source: "existing" });
    expect(noDownloadSource.calls).toEqual([]);
  });

  it("falls back only to a manifest-known existing binary whose SHA-256 still verifies", async () => {
    const versionOne = artifactFixture("1.0.0", Buffer.from("verified fallback frpc"));
    const installed = await managerFor(
      versionOne.manifest,
      new FixtureArtifactSource([[versionOne.artifact.downloadUrl, versionOne.archive]]),
    ).ensureManagedFrpc();
    const versionTwo = artifactFixture("2.0.0", Buffer.from("desired update frpc"));
    const upgradeManifest: SafeTunnelFrpcManifest = {
      desiredVersion: "2.0.0",
      releases: [versionTwo.release, versionOne.release],
    };
    const privateFailure = new Error("download https://private.example/token failed: provider-secret");
    const failingSource = new FixtureArtifactSource([
      [versionTwo.artifact.downloadUrl, privateFailure],
    ]);

    const fallback = await managerFor(upgradeManifest, failingSource).ensureManagedFrpc();

    expect(fallback).toEqual({
      path: installed.path,
      version: "1.0.0",
      desiredVersion: "2.0.0",
      platform: "linux",
      architecture: "arm64",
      source: "fallback",
      updateErrorCode: "download_failed",
    });
    expect(JSON.stringify(fallback)).not.toContain("provider-secret");
    expect(JSON.stringify(fallback)).not.toContain("private.example");

    const tamperedUpdate = tarGzipFixture([{
      path: versionTwo.artifact.archiveEntryPath,
      contents: Buffer.from("tampered update frpc"),
    }]);
    await expect(managerFor(
      upgradeManifest,
      new FixtureArtifactSource([[versionTwo.artifact.downloadUrl, tamperedUpdate]]),
    ).ensureManagedFrpc()).resolves.toMatchObject({
      source: "fallback",
      version: "1.0.0",
      updateErrorCode: "checksum_mismatch",
    });

    await writeFile(installed.path, "corrupted fallback");
    const failure = await captureError(
      managerFor(upgradeManifest, failingSource).ensureManagedFrpc(),
    );
    expect(failure).toMatchObject({ code: "download_failed" });
    expect(errorDiagnostic(failure)).not.toContain("provider-secret");
  });

  it("rejects malformed archives, non-regular target entries, and checksum mismatches without installing them", async () => {
    const executable = Buffer.from("expected executable bytes");
    const valid = artifactFixture("1.0.0", executable);
    const malformed = artifactFixture("1.0.0", executable, undefined, {
      archive: Buffer.from("not a gzip archive"),
    });
    const malformedSource = new FixtureArtifactSource([
      [malformed.artifact.downloadUrl, malformed.archive],
    ]);
    await expect(managerFor(malformed.manifest, malformedSource).ensureManagedFrpc())
      .rejects.toMatchObject({ code: "invalid_archive" });

    const symlinkArchive = tarGzipFixture([{
      path: valid.artifact.archiveEntryPath,
      contents: Buffer.alloc(0),
      typeFlag: "2",
    }]);
    const symlink = artifactFixture("1.0.0", executable, undefined, {
      archive: symlinkArchive,
    });
    await expect(managerFor(
      symlink.manifest,
      new FixtureArtifactSource([[symlink.artifact.downloadUrl, symlink.archive]]),
    ).ensureManagedFrpc()).rejects.toMatchObject({ code: "invalid_archive" });

    const tamperedArchive = tarGzipFixture([{
      path: valid.artifact.archiveEntryPath,
      contents: Buffer.from("tampered executable bytes"),
    }]);
    const tampered = artifactFixture("1.0.0", executable, undefined, {
      archive: tamperedArchive,
    });
    await expect(managerFor(
      tampered.manifest,
      new FixtureArtifactSource([[tampered.artifact.downloadUrl, tampered.archive]]),
    ).ensureManagedFrpc()).rejects.toMatchObject({ code: "checksum_mismatch" });

    await expect(readdir(join(tempDirectory, "safe-tunnel", "frpc")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed for a target omitted from the production manifest before downloading", async () => {
    const source = new FixtureArtifactSource([]);
    const manager = new SafeTunnelFrpcManager({
      archiveExtractor: new TarGzipSafeTunnelFrpcArchiveExtractor(),
      artifactSource: source,
      installationStore: new FileSafeTunnelFrpcInstallationStore({
        installDirectory: join(tempDirectory, "safe-tunnel", "frpc"),
        platform: "darwin",
      }),
      manifest: safeTunnelFrpcManifest,
      platform: "darwin",
      architecture: "x64",
    });

    await expect(manager.ensureManagedFrpc()).rejects.toMatchObject({
      code: "unsupported_platform",
      message: "PI WEB does not provide a managed Safe Tunnel runtime for this platform and architecture.",
    });
    expect(source.calls).toEqual([]);
    await expect(readdir(join(tempDirectory, "safe-tunnel", "frpc")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsafe or ambiguous injected manifests with one redacted application error", () => {
    const fixture = artifactFixture("1.0.0", Buffer.from("fixture"));
    const invalidArtifactValues: readonly (
      readonly [keyof SafeTunnelFrpcArtifact, unknown]
    )[] = [
      ["archiveEntryPath", "../frpc"],
      ["archiveFormat", "zip"],
      ["archiveSha256", "not-a-sha256"],
      ["archiveSize", 0],
      ["downloadUrl", "http://artifacts.example.test/frpc.tar.gz"],
      ["downloadUrl", "https://user:secret@artifacts.example.test/frpc.tar.gz"],
      ["executableSha256", "not-a-sha256"],
      ["executableSize", 0],
    ];
    const invalidManifests: readonly SafeTunnelFrpcManifest[] = [
      ...invalidArtifactValues.map(([field, value]) => {
        const artifact = { ...fixture.artifact };
        Object.defineProperty(artifact, field, { value });
        return {
          desiredVersion: "1.0.0",
          releases: [{ ...fixture.release, artifacts: [artifact] }],
        };
      }),
      {
        desiredVersion: "missing",
        releases: [fixture.release],
      },
      {
        desiredVersion: "1.0.0",
        releases: [{
          ...fixture.release,
          artifacts: [fixture.artifact, fixture.artifact],
        }],
      },
    ];

    for (const invalid of invalidManifests) {
      expect(() => managerFor(invalid, new FixtureArtifactSource([]))).toThrow(
        new SafeTunnelFrpcAcquisitionError("invalid_manifest"),
      );
    }
  });
});

interface ArtifactFixtureOptions {
  readonly archive?: Uint8Array;
  readonly archiveEntryPath?: string;
}

interface ArtifactFixture {
  readonly archive: Uint8Array;
  readonly artifact: SafeTunnelFrpcArtifact;
  readonly manifest: SafeTunnelFrpcManifest;
  readonly release: SafeTunnelFrpcRelease;
}

function artifactFixture(
  version: string,
  executable: Uint8Array,
  downloadUrl = `https://fixtures.example.test/frp-${version}.tar.gz`,
  options: ArtifactFixtureOptions = {},
): ArtifactFixture {
  const archiveEntryPath = options.archiveEntryPath ?? `frp_${version}_linux_arm64/frpc`;
  const archive = options.archive
    ?? tarGzipFixture([{ path: archiveEntryPath, contents: executable }]);
  const artifact: SafeTunnelFrpcArtifact = {
    platform: "linux",
    architecture: "arm64",
    archiveFormat: "tar.gz",
    archiveSha256: createHash("sha256").update(archive).digest("hex"),
    archiveSize: archive.byteLength,
    archiveEntryPath,
    downloadUrl,
    executableSha256: createHash("sha256").update(executable).digest("hex"),
    executableSize: executable.byteLength,
  };
  const release: SafeTunnelFrpcRelease = { version, artifacts: [artifact] };
  return {
    archive,
    artifact,
    release,
    manifest: { desiredVersion: version, releases: [release] },
  };
}

function managerFor(
  manifest: SafeTunnelFrpcManifest,
  artifactSource: SafeTunnelFrpcArtifactSource,
): SafeTunnelFrpcManager {
  return new SafeTunnelFrpcManager({
    archiveExtractor: new TarGzipSafeTunnelFrpcArchiveExtractor(),
    artifactSource,
    installationStore: new FileSafeTunnelFrpcInstallationStore({
      installDirectory: join(tempDirectory, "safe-tunnel", "frpc"),
      platform: "linux",
    }),
    manifest,
    platform: "linux",
    architecture: "arm64",
  });
}

class FixtureArtifactSource implements SafeTunnelFrpcArtifactSource {
  readonly calls: string[] = [];
  private readonly responses: Map<string, Uint8Array | Error>;

  constructor(entries: readonly (readonly [string, Uint8Array | Error])[]) {
    this.responses = new Map(entries);
  }

  download(artifact: SafeTunnelFrpcArtifact): Promise<Uint8Array> {
    this.calls.push(artifact.downloadUrl);
    const response = this.responses.get(artifact.downloadUrl);
    if (response instanceof Error) return Promise.reject(response);
    if (response === undefined) return Promise.reject(new Error("Unexpected fixture download"));
    return Promise.resolve(Uint8Array.from(response));
  }
}

interface LoopbackServer {
  readonly origin: string;
}

async function listen(listener: RequestListener): Promise<LoopbackServer> {
  const server = createServer(listener);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Loopback server has no TCP address");
  return { origin: `http://127.0.0.1:${address.port.toString()}` };
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}

interface TarFixtureEntry {
  readonly path: string;
  readonly contents: Uint8Array;
  readonly typeFlag?: "0" | "2";
}

function tarGzipFixture(entries: readonly TarFixtureEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const header = Buffer.alloc(512);
    writeTarText(header, 0, 100, entry.path);
    writeTarOctal(header, 100, 8, 0o755);
    writeTarOctal(header, 108, 8, 0);
    writeTarOctal(header, 116, 8, 0);
    writeTarOctal(header, 124, 12, entry.contents.byteLength);
    writeTarOctal(header, 136, 12, 0);
    header.fill(32, 148, 156);
    header[156] = (entry.typeFlag ?? "0").charCodeAt(0);
    writeTarText(header, 257, 6, "ustar");
    writeTarText(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeTarChecksum(header, checksum);
    blocks.push(header, Buffer.from(entry.contents));
    const padding = (512 - (entry.contents.byteLength % 512)) % 512;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

function writeTarText(
  header: Buffer,
  offset: number,
  length: number,
  value: string,
): void {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength > length) throw new Error("Tar fixture field is too long");
  bytes.copy(header, offset);
}

function writeTarOctal(
  header: Buffer,
  offset: number,
  length: number,
  value: number,
): void {
  const source = `${value.toString(8).padStart(length - 1, "0")}\0`;
  writeTarText(header, offset, length, source);
}

function writeTarChecksum(header: Buffer, checksum: number): void {
  const source = `${checksum.toString(8).padStart(6, "0")}\0 `;
  writeTarText(header, 148, 8, source);
}

async function temporaryInstallFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await visit(root, files);
  return files.filter((path) => path.includes(".tmp"));
}

async function visit(path: string, files: string[]): Promise<void> {
  const entries = await readdir(path, { withFileTypes: true });
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) await visit(child, files);
    else files.push(child);
  }
}

async function captureError(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof Error) return error;
    throw new Error("Expected an Error rejection", { cause: error });
  }
  throw new Error("Expected promise to reject");
}

function errorDiagnostic(error: Error): string {
  return `${error.name}: ${error.message} ${JSON.stringify(error)}`;
}
