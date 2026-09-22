#!/usr/bin/env node
/**
 * Fill in the integrity hashes npm leaves off nested registry entries.
 *
 * Every pi bump so far has produced a lockfile where the copies npm nests
 * under `@earendil-works/pi-coding-agent` carry no `integrity`. Nix refuses
 * such a lockfile outright - "non-git dependencies should have associated
 * integrity" - so the break only shows up in the release build, after the
 * JavaScript checks are long green. The values come from the registry the
 * entry already names, so this adds nothing npm did not resolve itself.
 *
 * Run after any dependency change; `npm run verify` fails when an entry is
 * still missing one.
 */

import { readFile, writeFile } from "node:fs/promises";

const LOCKFILE = process.argv[2] ?? "package-lock.json";
const REGISTRY = "https://registry.npmjs.org/";

function missingIntegrity(lock) {
  return Object.entries(lock.packages ?? {}).filter(([name, entry]) => {
    if (name === "" || entry.link === true) return false;
    const resolved = typeof entry.resolved === "string" ? entry.resolved : "";
    return resolved.startsWith(REGISTRY) && typeof entry.integrity !== "string";
  });
}

async function integrityOf(packageName, version) {
  const url = `${REGISTRY}${packageName.replace("/", "%2f")}/${version}`;
  const answer = await fetch(url);
  if (!answer.ok) throw new Error(`the registry would not describe ${packageName}@${version} (${String(answer.status)})`);
  const metadata = await answer.json();
  const integrity = metadata?.dist?.integrity;
  if (typeof integrity !== "string") throw new Error(`the registry has no integrity for ${packageName}@${version}`);
  return integrity;
}

const lock = JSON.parse(await readFile(LOCKFILE, "utf-8"));
const gaps = missingIntegrity(lock);
if (gaps.length === 0) {
  console.log("every registry entry already carries its integrity");
  process.exit(0);
}

for (const [name, entry] of gaps) {
  const packageName = name.split("node_modules/").pop();
  entry.integrity = await integrityOf(packageName, entry.version);
  console.log(`filled ${packageName}@${entry.version}`);
}

await writeFile(LOCKFILE, `${JSON.stringify(lock, null, 2)}\n`, "utf-8");
console.log(`wrote ${LOCKFILE}`);
