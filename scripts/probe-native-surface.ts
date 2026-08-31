/**
 * match-tui-prompt 4.1 probe: construct a NATIVE host session (the SDK's own
 * path — what a `pi` TUI session receives) over the same cwd, agent dir, and
 * model resolution as a live PI WEB session, then diff it against the live
 * session's captured model surface (the /api/debug/model-surface route).
 *
 * Run with the 8505 stack up:
 *   npx tsx scripts/probe-native-surface.ts /private/tmp/test
 *
 * Writes the diff artifacts to /tmp/n41-*.txt and prints a summary. The diff
 * is evidence, not a gate: this probe never fails on deviations, it records
 * them.
 */

import { get } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager } from "@earendil-works/pi-coding-agent";
import { defaultPiSessionDir } from "../src/server/daemon/sessions/piSessionManagerGateway.js";
import { createTestModelRuntime } from "../src/server/daemon/sessions/piSessionService.testSupport.js";
import { sessionEnvironmentPromptSections } from "../src/server/daemon/sessions/sessionEnvironmentFacts.js";

const cwd = process.argv[2] ?? "/private/tmp/test";
const agentDir = process.argv[3] ?? join(homedir(), ".pi", "agent");
const socketPath = process.argv[4] ?? join(homedir(), ".pi-web-8505", "sessiond.sock");
const sessionId = process.argv[5] ?? "";

function fetchSurface(): Promise<{ available: boolean; systemPrompt?: string; tools?: Array<{ name: string; description: string }> }> {
  return new Promise((resolve, reject) => {
    const request = get(
      { socketPath, path: `/api/debug/model-surface?sessionId=${encodeURIComponent(sessionId)}`, headers: { host: "localhost" } },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => {
          try { resolve(JSON.parse(body) as { available: boolean; systemPrompt?: string; tools?: Array<{ name: string; description: string }> }); }
          catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
        });
      },
    );
    request.on("error", (error) => reject(error));
  });
}

const captured = await fetchSurface();
if (captured.available !== true || captured.systemPrompt === undefined || captured.tools === undefined) {
  throw new Error("the live session's model surface is unavailable — is the session active and PI_WEB_DEBUG_PROMPT_CAPTURE=1?");
}

// The NATIVE host: the SDK's own service constructor with NO web options, the
// same cwd/agentDir, the same model resolution (no initial model — both sides
// resolve from the stored settings).
const modelRuntime = await createTestModelRuntime();
const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
const result = await createAgentSessionFromServices({
  services,
  sessionManager: SessionManager.create(cwd, defaultPiSessionDir(cwd, agentDir)),
});
const native = result.session;

// The declared seam, from the daemon's own environment (the probe runs outside
// the daemon, so reconstruct what sessiond registered for that environment).
const daemonEnvironment: NodeJS.ProcessEnv = {
  PI_WEB_DATA_DIR: join(homedir(), ".pi-web-8505"),
  PI_WEB_SESSIOND_SOCKET: socketPath,
};
const declaredSections = sessionEnvironmentPromptSections({ env: daemonEnvironment, enabled: true });

const capturedPrompt = captured.systemPrompt;
const nativePrompt = native.systemPrompt;
const prefixShared = capturedPrompt.startsWith(nativePrompt);
let recovered = capturedPrompt;
for (const section of declaredSections) {
  const at = recovered.indexOf(section);
  if (at >= 0) {
    const before = recovered.slice(0, at);
    let after = recovered.slice(at + section.length);
    if (after.startsWith("\n\n")) after = after.slice(2);
    else if (before.endsWith("\n\n")) recovered = before.slice(0, -2);
    recovered = before + after;
  }
}
const promptDeltaFullyExplained = recovered === nativePrompt;

const capturedTools = new Map(captured.tools.map((tool) => [tool.name, tool.description]));
const nativeTools = new Map(native.getAllTools().map((tool) => [tool.name, tool.description]));
const added = [...capturedTools.keys()].filter((name) => !nativeTools.has(name));
const removed = [...nativeTools.keys()].filter((name) => !capturedTools.has(name));
const rewritten = [...capturedTools.keys()].filter((name) => nativeTools.has(name) && nativeTools.get(name) !== capturedTools.get(name));

await writeFile("/tmp/n41-captured-prompt.txt", capturedPrompt, "utf8");
await writeFile("/tmp/n41-native-prompt.txt", nativePrompt, "utf8");
const lines = [
  `captured prompt: ${capturedPrompt.length} chars; native prompt: ${nativePrompt.length} chars; prefix-shared=${prefixShared}`,
  `declared seam sections: ${declaredSections.length}; prompt delta fully explained by the seam: ${promptDeltaFullyExplained}`,
  `tools: captured ${capturedTools.size}, native ${nativeTools.size}`,
  `tool ADD (captured only): ${added.join(", ") || "(none)"}`,
  `tool REMOVE (native only): ${removed.join(", ") || "(none)"}`,
  `tool REWRITE (description differs): ${rewritten.join(", ") || "(none)"}`,
];
await writeFile("/tmp/n41-diff.txt", `${lines.join("\n")}\n`, "utf8");
for (const line of lines) console.log(line);
