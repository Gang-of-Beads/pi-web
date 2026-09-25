#!/usr/bin/env node
/**
 * Run every live probe against the 8505 stack, one after another.
 *
 * The probes pass alone and interfered in sequence: one leaves a turn running
 * or a question form open, and the next one's precondition ("the turn started
 * streaming") never comes - so a batch run read as failures that were nothing
 * of the sort. This quiesces between probes: waits for the session to go idle
 * and cancels any open question form, which is the state every probe assumes.
 *
 * Usage: node scripts/run-probes.mjs [probe-name ...]
 */

import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";

const BASE = process.env.PI_WEB_PROBE_BASE ?? "http://127.0.0.1:8505";
const CWD = process.env.PI_WEB_PROBE_CWD ?? "/Users/hanxiao.du/.pi-web-8505/pi-web-8505-seed-workspace";
const SESSION = process.env.PI_WEB_PROBE_SESSION ?? "01a05000-5eed-7c00-8000-0000000000c1";

const sessionPath = (suffix) => `${BASE}/api/sessions/${SESSION}/${suffix}${suffix.includes("?") ? "&" : "?"}cwd=${encodeURIComponent(CWD)}`;

async function status() {
  try {
    const answer = await fetch(sessionPath("status"));
    return answer.ok ? await answer.json() : undefined;
  } catch {
    return undefined;
  }
}

async function quiesce(label) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const now = await status();
    if (now === undefined) return;
    const asks = now.pendingAsks ?? (now.pendingAsk === undefined ? [] : [now.pendingAsk]);
    for (const ask of asks) {
      try {
        // The route is /ask/cancel with the ask in the body, not in the path.
        await fetch(`${BASE}/api/sessions/${SESSION}/ask/cancel`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cwd: CWD, askId: ask.askId }),
        });
      } catch { /* the next round tries again */ }
    }
    if (now.isStreaming !== true && asks.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  console.error(`  ${label}: still busy after 120s`);
}

function runProbe(name) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [`scripts/${name}.mjs`], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { output += String(chunk); });
    child.on("close", (code) => { resolve({ code: code ?? 1, output }); });
  });
}

const requested = process.argv.slice(2);
const all = (await readdir("scripts")).filter((name) => name.startsWith("probe-") && name.endsWith(".mjs")).map((name) => name.replace(/\.mjs$/u, "")).sort();
const names = requested.length > 0 ? requested : all;

const results = [];
for (const name of names) {
  await quiesce(name);
  const started = Date.now();
  const { code, output } = await runProbe(name);
  const second = Math.round((Date.now() - started) / 1000);
  const last = output.trim().split("\n").at(-1) ?? "";
  results.push({ name, code, last, second });
  console.log(`${code === 0 ? "PASS" : "FAIL"} ${name} (${String(second)}s) ${last.slice(0, 120)}`);
}

const failed = results.filter((result) => result.code !== 0);
console.log(`\n${String(results.length - failed.length)}/${String(results.length)} probes passed`);
if (failed.length > 0) {
  console.log(`failed: ${failed.map((result) => result.name).join(", ")}`);
  process.exitCode = 1;
}
