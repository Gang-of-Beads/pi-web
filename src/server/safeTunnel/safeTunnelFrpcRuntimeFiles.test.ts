import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileSafeTunnelFrpcRuntimeFiles,
  safeTunnelFrpcConfigFileMode,
  safeTunnelFrpcLogFileMode,
  safeTunnelFrpcRuntimeDirectoryMode,
} from "./safeTunnelFrpcRuntimeFiles.js";

let tempDirectory: string;

beforeEach(async () => {
  tempDirectory = await mkdtemp(join(tmpdir(), "pi-web-safe-tunnel-runtime-files-"));
});

afterEach(async () => {
  await rm(tempDirectory, { recursive: true, force: true });
});

describe("FileSafeTunnelFrpcRuntimeFiles", () => {
  it("atomically replaces private config and keeps a private sanitized log", async () => {
    const runtimeDirectory = join(tempDirectory, "safe-tunnel");
    const configPath = join(runtimeDirectory, "frpc.toml");
    const logPath = join(runtimeDirectory, "frpc.log");
    const files = new FileSafeTunnelFrpcRuntimeFiles({
      configPath,
      logPath,
      platform: "linux",
    });
    await writeFile(join(tempDirectory, "unrelated"), "keep");

    await files.writeConfig("serverAddr = \"relay.example.test\"\nauth.token = \"private\"\n");
    await files.writeConfig("serverAddr = \"new-relay.example.test\"\n");
    await files.resetLog("private header\n");
    files.appendLog("\u001B[31mfrpc failed\u001B[0m\n");
    await files.flushLog();

    expect(await readFile(configPath, "utf8")).toBe(
      "serverAddr = \"new-relay.example.test\"\n",
    );
    expect((await stat(runtimeDirectory)).mode & 0o777)
      .toBe(safeTunnelFrpcRuntimeDirectoryMode);
    expect((await stat(configPath)).mode & 0o777)
      .toBe(safeTunnelFrpcConfigFileMode);
    expect((await stat(logPath)).mode & 0o777)
      .toBe(safeTunnelFrpcLogFileMode);
    expect((await readdir(runtimeDirectory)).sort()).toEqual(["frpc.log", "frpc.toml"]);

    await expect(files.status()).resolves.toEqual({
      configExists: true,
      logExists: true,
      logTail: "private header\nfrpc failed\n",
    });

    await files.removeConfig();
    await expect(files.status()).resolves.toMatchObject({
      configExists: false,
      logExists: true,
    });
  });

  it("reports non-file runtime paths without reading them", async () => {
    const configPath = join(tempDirectory, "safe-tunnel");
    const files = new FileSafeTunnelFrpcRuntimeFiles({
      configPath,
      logPath: join(tempDirectory, "frpc.log"),
    });
    await mkdir(configPath);
    await files.resetLog("");

    await expect(files.status()).resolves.toMatchObject({
      configExists: false,
      configError: "Safe Tunnel runtime path is not a regular file.",
    });
  });
});
