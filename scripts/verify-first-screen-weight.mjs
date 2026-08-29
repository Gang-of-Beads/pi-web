/**
 * The composer's editor is heavy - CodeMirror core plus languages measured
 * 649KB - and it rode the critical path: index.html modulepreloaded both, so
 * the first paint waited on an editor nobody had focused yet.
 *
 * The invariant: editor vendor chunks stay off the preload list; they load
 * when the composer mounts.
 *
 * Usage: node scripts/verify-first-screen-weight.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = "dist/client";
const html = readFileSync(join(root, "index.html"), "utf8");
const preloaded = [...html.matchAll(/modulepreload[^>]*href="\.\/(assets\/[^"]+)"/gu)].map((m) => m[1]);

const assets = readdirSync(join(root, "assets")).filter((f) => f.endsWith(".js"));
const sizeOf = (file) => statSync(join(root, "assets", file)).size;
const editorChunks = assets.filter((f) => f.startsWith("vendor-editor"));

if (editorChunks.length === 0) {
  console.error("FAIL: no editor vendor chunks exist, so nothing was measured - the split itself is gone");
  process.exit(1);
}

const preloadedEditor = preloaded.filter((p) => p.includes("vendor-editor"));
const preloadedBytes = preloaded.reduce((sum, p) => sum + sizeOf(p.replace("assets/", "")), 0);
const indexBytes = assets.filter((f) => f.startsWith("index-")).reduce((sum, f) => sum + sizeOf(f), 0);

console.log(`critical path: index ${String(Math.round(indexBytes / 1024))}KB + preloads ${String(Math.round(preloadedBytes / 1024))}KB`);
console.log(`editor chunks: ${editorChunks.map((f) => `${f.split("-").slice(0, 3).join("-")} ${String(Math.round(sizeOf(f) / 1024))}KB`).join(", ")}`);

if (preloadedEditor.length > 0) {
  console.error(`FAIL: the first paint still waits on ${preloadedEditor.join(", ")}`);
  process.exitCode = 1;
} else {
  console.log("PASS: the editor loads when the composer mounts, not before first paint");
}
