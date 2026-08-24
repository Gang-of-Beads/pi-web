import { chmod, mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const scriptPath = new URL("./ensure-node-pty-executable.mjs", import.meta.url).pathname;
const dirs = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A fake install tree whose `node-pty` ships the helper the way npm publishes
 * it: readable, not executable (microsoft/node-pty#850).
 */
async function fakeInstall(mode) {
  const root = await mkdtemp(join(tmpdir(), "pi-web-pty-"));
  dirs.push(root);
  const pkg = join(root, "node_modules", "node-pty");
  const helper = join(pkg, "prebuilds", "darwin-arm64", "spawn-helper");
  await mkdir(join(pkg, "prebuilds", "darwin-arm64"), { recursive: true });
  await writeFile(join(pkg, "package.json"), `${JSON.stringify({ name: "node-pty", version: "1.1.0", main: "index.js" })}\n`);
  await writeFile(join(pkg, "index.js"), "module.exports = {};\n");
  await writeFile(helper, "#!/bin/sh\nexit 0\n");
  await chmod(helper, mode);
  return { root, helper };
}

async function isExecutable(path) {
  return ((await stat(path)).mode & 0o111) === 0o111;
}

describe("ensure-node-pty-executable", () => {
  it("restores the execute bit npm strips from the published helper", async () => {
    const { root, helper } = await fakeInstall(0o644);

    const result = await run(process.execPath, [scriptPath], { cwd: root });

    expect(await isExecutable(helper)).toBe(true);
    expect(result.stdout).toContain("restored execute bit");
  });

  it("says nothing and changes nothing when the helper is already executable", async () => {
    const { root, helper } = await fakeInstall(0o755);

    const result = await run(process.execPath, [scriptPath], { cwd: root });

    expect(await isExecutable(helper)).toBe(true);
    expect(result.stdout).toBe("");
  });

  it("succeeds quietly when node-pty is not installed at all", async () => {
    const root = await mkdtemp(join(tmpdir(), "pi-web-no-pty-"));
    dirs.push(root);

    const result = await run(process.execPath, [scriptPath], { cwd: root });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
