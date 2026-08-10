import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FileSafeTunnelFrpcRuntimeFiles,
  safeTunnelFrpcConfigFileMode,
  safeTunnelFrpcLogFileMode,
  safeTunnelFrpcLogTailCharacters,
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
  it("derives colocated runtime paths without touching the filesystem", async () => {
    const runtimeDirectory = join(tempDirectory, "safe-tunnel");
    const files = new FileSafeTunnelFrpcRuntimeFiles({
      statePath: join(runtimeDirectory, "config.json"),
    });

    expect(files.configPath).toBe(join(runtimeDirectory, "frpc.toml"));
    expect(files.logPath).toBe(join(runtimeDirectory, "frpc.log"));
    await expect(stat(runtimeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

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

  it("serializes appended chunks and bounds the visible diagnostic tail", async () => {
    const logPath = join(tempDirectory, "safe-tunnel", "frpc.log");
    const files = new FileSafeTunnelFrpcRuntimeFiles({
      configPath: join(tempDirectory, "safe-tunnel", "frpc.toml"),
      logPath,
      platform: "linux",
    });
    const chunks = Array.from({ length: 64 }, (_, index) => `chunk-${index.toString()}\n`);

    await files.resetLog("");
    for (const chunk of chunks) files.appendLog(chunk);
    await files.flushLog();

    expect(await readFile(logPath, "utf8")).toBe(chunks.join(""));

    const visibleSuffix = `\u001B[32m${"x".repeat(safeTunnelFrpcLogTailCharacters)}end\u001B[0m`;
    await files.resetLog(`discarded\n${visibleSuffix}`);
    const status = await files.status();

    expect(status.logTail).toHaveLength(safeTunnelFrpcLogTailCharacters);
    expect(status.logTail).toBe(`${"x".repeat(safeTunnelFrpcLogTailCharacters - 3)}end`);
    expect(status.logTail).not.toContain("\u001B");
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

  it.skipIf(process.platform === "win32")(
    "treats symbolic links as non-file runtime paths without exposing their targets",
    async () => {
      const runtimeDirectory = join(tempDirectory, "safe-tunnel");
      const configPath = join(runtimeDirectory, "frpc.toml");
      const logPath = join(runtimeDirectory, "frpc.log");
      const targetPath = join(tempDirectory, "outside-private-runtime");
      const secret = "must-not-appear-in-status";
      await mkdir(runtimeDirectory);
      await writeFile(targetPath, secret);
      await symlink(targetPath, configPath);
      await symlink(targetPath, logPath);
      const files = new FileSafeTunnelFrpcRuntimeFiles({ configPath, logPath });

      const status = await files.status();

      expect(status).toEqual({
        configExists: false,
        configError: "Safe Tunnel runtime path is not a regular file.",
        logExists: false,
        logError: "Safe Tunnel runtime path is not a regular file.",
      });
      expect(JSON.stringify(status)).not.toContain(secret);
    },
  );
});
