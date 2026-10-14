import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** A standalone consumer must not borrow the host's dependencies to make its declarations compile. */
async function smokePluginApiPackage(tarball, fixtureParent) {
  assert(tarball && fixtureParent, "Usage: node scripts/smoke-plugin-api-package.mjs <tarball> <external-fixture-directory>");
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const consumerRoot = await mkdtemp(join(resolve(fixtureParent), "plugin-api-consumer-"));
  assert(relative(repoRoot, consumerRoot).startsWith(".."), "The consumer fixture must live outside the repository");
  const manifest = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  await writeFile(join(consumerRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", resolve(tarball), `lit@${manifest.dependencies.lit}`], { cwd: consumerRoot, stdio: "inherit" });

  for (const name of ["browser", "server"]) {
    const source = await readFile(join(repoRoot, "test-fixtures", "plugin-api-consumers", `${name}.ts`), "utf8");
    await writeFile(join(consumerRoot, `${name}.ts`), source.replaceAll("@gang-of-beads/pi-web/", "@gang-of-beads/pi-web-plugin-api/"));
  }
  const compiler = join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  for (const [module, resolution] of [["NodeNext", "NodeNext"], ["ESNext", "Bundler"], ["ESNext", "Node10"]]) {
    for (const [name, lib] of [["browser", "ES2022,DOM"], ["server", "ES2022"]]) {
      execFileSync(process.execPath, [compiler, "--noEmit", "--strict", "--skipLibCheck", "false", "--target", "ES2022", "--module", module, "--moduleResolution", resolution, "--ignoreDeprecations", "6.0", "--lib", lib, `${name}.ts`], { cwd: consumerRoot, stdio: "inherit" });
    }
  }

  const lock = JSON.parse(await readFile(join(consumerRoot, "package-lock.json"), "utf8"));
  assert(!Object.keys(lock.packages).some(path => /node_modules\/(?:@gang-of-beads\/pi-web|node-pty)$/.test(path)), "The lightweight package must not install the host or node-pty");
  const runtimeSource = [
    'import assert from "node:assert/strict";',
    'import { CORE_STATUS_FLAGS } from "@gang-of-beads/pi-web-plugin-api/plugin-api";',
    'import { parsePiWebRuntimeResponse } from "@gang-of-beads/pi-web-plugin-api/server-plugin-api";',
    'assert.equal(CORE_STATUS_FLAGS.working, "core:working");',
    'assert.equal(parsePiWebRuntimeResponse(null), undefined);',
  ].join("\n");
  await writeFile(join(consumerRoot, "runtime.mjs"), runtimeSource);
  execFileSync(process.execPath, [join(consumerRoot, "runtime.mjs")], { cwd: consumerRoot, stdio: "inherit" });
  console.log("Plugin API package: separate browser/server consumers passed under NodeNext, Bundler and Node10; runtime exports passed; no host or node-pty installed.");
}

await smokePluginApiPackage(process.argv[2], process.argv[3]);
