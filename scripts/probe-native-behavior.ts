/**
 * match-tui-prompt 4.2 probe, NATIVE leg: drive several turns of a standing
 * instruction through a NATIVE host session (the SDK's own construction —
 * what a `pi` TUI session receives) with the same model the PI WEB leg uses,
 * and record whether the instruction is honoured in every reply.
 *
 * Run with real credentials present:
 *   npx tsx scripts/probe-native-behavior.ts
 *
 * Writes the full transcript to /tmp/n42-native-transcript.txt and prints a
 * per-turn verdict. Evidence, not proof: the script records what happened.
 */

import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager } from "@earendil-works/pi-coding-agent";
import { createModelRuntimeForAgentDir } from "../src/server/sessions/authService.js";
import { defaultPiSessionDir } from "../src/server/sessions/piSessionManagerGateway.js";

const MARKER = "STANDING-442";
const agentDir = join(homedir(), ".pi", "agent");
const tempDir = await mkdtemp(join(tmpdir(), "pi-web-n42-native-"));
const cwd = join(tempDir, "workspace");
await import("node:fs/promises").then((fs) => fs.mkdir(cwd, { recursive: true }));

const modelRuntime = await createModelRuntimeForAgentDir(agentDir);
const model = modelRuntime.getModel("botim-bllm", "glm-5.3-flash");
if (model === undefined) throw new Error("the comparison model is not in the catalog");

const services = await createAgentSessionServices({ cwd, agentDir, modelRuntime });
const result = await createAgentSessionFromServices({
  services,
  sessionManager: SessionManager.create(cwd, defaultPiSessionDir(cwd, agentDir)),
  model,
});
const session = result.session;

const turns: string[] = [
  "Standing instruction for the rest of this session: every reply you produce must END with the exact line STANDING-442 on its own line. Confirm by replying with just: ready",
  "What is 2+2? Reply with just the number.",
  "Reply with just: done",
];

const transcript: string[] = [`model: botim-bllm/glm-5.3-flash (native host, SDK default construction)`, ""];

/** The assistant's visible text: the concatenated text blocks of the message. */
function assistantText(message: unknown): string {
  const content = (message as { content?: Array<{ type: string; text?: string }> }).content;
  if (!Array.isArray(content)) return "";
  return content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n").trim();
}

let allHonoured = true;
for (const [index, turn] of turns.entries()) {
  transcript.push(`--- TURN ${index + 1} (user) ---`, turn, "");
  await session.prompt(turn);
  const messages = session.messages;
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const text = lastAssistant === undefined ? "(no assistant message)" : assistantText(lastAssistant);
  transcript.push(`--- TURN ${index + 1} (assistant) ---`, text, "");
  const lastLine = text.trimEnd().split("\n").pop()?.trim() ?? "";
  const honoured = lastLine === MARKER;
  if (!honoured) allHonoured = false;
  console.log(`turn ${index + 1}: marker ${honoured ? "HONOURED" : "MISSING"} (last line: ${JSON.stringify(lastLine.slice(0, 80))})`);
}

await writeFile("/tmp/n42-native-transcript.txt", transcript.join("\n"), "utf8");
console.log(`native leg: standing instruction ${allHonoured ? "honoured in every reply" : "NOT honoured in every reply"}`);
await rm(tempDir, { recursive: true, force: true });
