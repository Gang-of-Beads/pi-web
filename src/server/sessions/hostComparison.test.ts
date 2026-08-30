/**
 * Host-vs-native comparison in recording mode (match-tui-prompt task 1.3).
 *
 * Both sessions are constructed over IDENTICAL inputs — the same cwd, the same
 * empty agent directory, the same model — through the SDK's own service
 * constructor. The NATIVE host is the SDK default: exactly what a `pi` TUI
 * session receives with no host above it. The WEB host applies exactly the
 * deltas PI WEB's real factory applies: the HostContributions seam's prompt
 * sections (`piWebResourceLoaderOptions`) and the web custom tools
 * (`createPiWebCustomToolDefinitions` with no delegation/subsession/ask deps —
 * the minimal web construction).
 *
 * The recording prints every deviation for the owner. Two assertions keep it
 * honest rather than decorative:
 *
 * 1. With the seam's prompt sections applied and an otherwise native tool
 *    set, the ENTIRE system-prompt delta is the seam's sections, appended in
 *    order — the seam explains 100% of the prompt difference, byte for byte.
 * 2. The message sequence at construction is identical under both hosts.
 *
 * Tool-surface deviations (today: the web edit-tool preview rewrite, which
 * the factory applies OUTSIDE the seam — the structural argument in task 2.5
 * says the seam has no tool surface) are printed, classified, and left for
 * the owner's 2.x dispositions. This test never fails on their existence.
 *
 * Run: `npx vitest run src/server/sessions/hostComparison.test.ts` — the
 * recording prints to the vitest output.
 */

import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentSessionFromServices, createAgentSessionServices, SessionManager } from "@earendil-works/pi-coding-agent";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { describeHostContributions, EMPTY_HOST_CONTRIBUTIONS } from "./hostContributions.js";
import { createPiWebCustomToolDefinitions, piWebResourceLoaderOptions } from "./piSessionService.js";
import { createTestModelRuntime, TEST_MODEL_ID, TEST_MODEL_PROVIDER, testModel } from "./piSessionService.testSupport.js";
import { sessionEnvironmentPromptSections } from "./sessionEnvironmentFacts.js";

let tempDir: string;
let cwd: string;
let agentDir: string;
let sessionsDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-host-comparison-"));
  cwd = join(tempDir, "workspace");
  agentDir = join(tempDir, "agent");
  sessionsDir = join(agentDir, "sessions");
  await mkdir(cwd, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });
});

afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** The prompt sections the real daemon registers, built from a fixed environment for determinism. */
const daemonEnvironment: NodeJS.ProcessEnv = { PI_WEB_DATA_DIR: "/tmp/pi-web-host-comparison-data" };
const seamSections = sessionEnvironmentPromptSections({ env: daemonEnvironment, enabled: true });

async function buildHost(options: {
  promptSections?: readonly string[];
  webCustomTools?: boolean;
}): Promise<AgentSession> {
  const resourceLoaderOptions = options.promptSections === undefined ? undefined : piWebResourceLoaderOptions(options.promptSections);
  const services = await createAgentSessionServices({
    cwd,
    agentDir,
    modelRuntime: await createTestModelRuntime(),
    ...(resourceLoaderOptions === undefined ? {} : { resourceLoaderOptions }),
  });
  const sessionManager = SessionManager.create(cwd, sessionsDir);
  const result = await createAgentSessionFromServices({
    services,
    sessionManager,
    model: testModel(),
    ...(options.webCustomTools === true
      ? { customTools: createPiWebCustomToolDefinitions(cwd, false, undefined, undefined, undefined) }
      : {}),
  });
  return result.session;
}

interface ToolRecording {
  name: string;
  description: string;
  promptGuidelines: string;
}

/** Stable comparable form of a tool field: strings as-is, everything else JSON (reference-insensitive). */
function stableField(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

function recordTools(session: AgentSession): ToolRecording[] {
  return session
    .getAllTools()
    .map((tool) => ({
      name: tool.name,
      description: stableField(tool.description),
      promptGuidelines: "promptGuidelines" in tool ? stableField(tool.promptGuidelines) : "null",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function printRecording(title: string, lines: string[]): void {
  console.log(`\n=== ${title} ===`);
  for (const line of lines) console.log(line);
}

describe("host-vs-native comparison (recording mode)", () => {
  it("records the deviations between the native TUI host and the PI WEB host", async () => {
    const native = await buildHost({});
    const seamOnly = await buildHost({ promptSections: seamSections });
    const web = await buildHost({ promptSections: seamSections, webCustomTools: true });

    // --- Prompt diff: seam-only vs native ---------------------------------
    // Probe finding (recorded): the loader does NOT append the seam's sections
    // at the prompt's end — the assembled prompt places them in a structural
    // slot before the skills block. The neutrality contract is therefore NOT
    // "the delta is a suffix" but "the seam fully explains the prompt delta":
    // removing exactly the seam's sections (and their paragraph separators)
    // from the web prompt reproduces the native prompt byte for byte.
    const nativePrompt = native.systemPrompt;
    const seamPrompt = seamOnly.systemPrompt;

    // The seam must explain 100% of the prompt delta: each registered section
    // appears exactly once, and excising them (with one adjacent paragraph
    // separator each) recovers the native prompt byte for byte.
    let recovered = seamPrompt;
    for (const section of seamSections) {
      const first = recovered.indexOf(section);
      const last = recovered.lastIndexOf(section);
      expect(first, `seam section must appear in the web prompt: ${section.slice(0, 60)}…`).toBeGreaterThanOrEqual(0);
      expect(first, `seam section must appear exactly once: ${section.slice(0, 60)}…`).toBe(last);
      let before = recovered.slice(0, first);
      let after = recovered.slice(first + section.length);
      // Swallow exactly ONE paragraph separator — the loader inserts the
      // section as its own paragraph between \n\n boundaries.
      if (after.startsWith("\n\n")) after = after.slice(2);
      else if (before.endsWith("\n\n")) before = before.slice(0, -2);
      recovered = before + after;
    }
    expect(recovered, "the prompt delta must be exactly the seam's sections — the seam explains 100% of the difference").toBe(nativePrompt);

    // --- Tool diff ---------------------------------------------------------
    const nativeTools = recordTools(native);
    const seamTools = recordTools(seamOnly);
    const webTools = recordTools(web);
    const seamToolDelta = {
      added: seamTools.filter((tool) => !nativeTools.some((n) => n.name === tool.name)),
      removed: nativeTools.filter((tool) => !seamTools.some((w) => w.name === tool.name)),
      rewritten: seamTools.filter((tool) => {
        const n = nativeTools.find((c) => c.name === tool.name);
        return n !== undefined && (n.description !== tool.description || n.promptGuidelines !== tool.promptGuidelines);
      }),
    };
    const webToolDelta = {
      added: webTools.filter((tool) => !seamTools.some((s) => s.name === tool.name)),
      removed: seamTools.filter((tool) => !webTools.some((w) => w.name === tool.name)),
      rewritten: webTools.filter((tool) => {
        const s = seamTools.find((c) => c.name === tool.name);
        return s !== undefined && (s.description !== tool.description || s.promptGuidelines !== tool.promptGuidelines);
      }),
    };

    // --- Message sequence at construction ----------------------------------
    const nativeMessages = JSON.stringify(native.messages);
    const webMessages = JSON.stringify(web.messages);
    expect(webMessages, "the message sequence at construction must be identical under both hosts").toBe(nativeMessages);

    // --- The recording ------------------------------------------------------
    const seamRows = describeHostContributions({ ...EMPTY_HOST_CONTRIBUTIONS, systemPromptSections: seamSections, unsupportedSurfaces: ["custom"] });
    const lines: string[] = [];
    lines.push(`inputs: cwd=${cwd} agentDir=${agentDir} model=${TEST_MODEL_PROVIDER}/${TEST_MODEL_ID}`);
    lines.push(`seam enumeration (describeHostContributions): ${String(seamRows.length)} rows`);
    for (const row of seamRows) lines.push(`  seam row: ${row.kind} — ${row.detail.slice(0, 72)}${row.detail.length > 72 ? "…" : ""}`);
    lines.push(`prompt: native ${String(nativePrompt.length)} chars, seam-only ${String(seamPrompt.length)} chars (delta ${String(seamPrompt.length - nativePrompt.length)} chars; seam fully explains it — asserted)`);
    lines.push(`tools: native ${String(nativeTools.length)}, seam-only ${String(seamToolDelta.added.length)} added / ${String(seamToolDelta.removed.length)} removed / ${String(seamToolDelta.rewritten.length)} rewritten`);
    for (const tool of seamToolDelta.added) lines.push(`  seam-only tool ADD: ${tool.name}`);
    for (const tool of seamToolDelta.removed) lines.push(`  seam-only tool REMOVE: ${tool.name}`);
    for (const tool of seamToolDelta.rewritten) lines.push(`  seam-only tool REWRITE: ${tool.name}`);
    lines.push(`tools: web ${String(webTools.length)} vs seam-only — ${String(webToolDelta.added.length)} added / ${String(webToolDelta.removed.length)} removed / ${String(webToolDelta.rewritten.length)} rewritten`);
    for (const tool of webToolDelta.added) lines.push(`  web tool ADD: ${tool.name}`);
    for (const tool of webToolDelta.removed) lines.push(`  web tool REMOVE: ${tool.name}`);
    for (const tool of webToolDelta.rewritten) {
      const before = seamTools.find((c) => c.name === tool.name);
      lines.push(`  web tool REWRITE: ${tool.name}`);
      if (before !== undefined && before.description !== tool.description) {
        lines.push(`    description before: ${before.description.slice(0, 120)}`);
        lines.push(`    description after:  ${tool.description.slice(0, 120)}`);
      }
      if (before !== undefined && before.promptGuidelines !== tool.promptGuidelines) {
        lines.push(`    guidelines before: ${before.promptGuidelines.slice(0, 120)}`);
        lines.push(`    guidelines after:  ${tool.promptGuidelines.slice(0, 120)}`);
      }
    }
    lines.push("messages at construction: identical (asserted above)");
    lines.push("behavior-level notes (invisible to getAllTools, recorded for the owner):");
    lines.push("  - edit tool: the web factory wraps execute (preview onUpdate) — same name/description/parameters/guidelines, different tool-result stream");
    lines.push("  - unsupportedSurfaces [custom]: runtime interception of extension free-form surfaces, not a construction-surface change");
    printRecording("HOST-vs-NATIVE recording (match-tui-prompt 1.3)", lines);

    // The seam's prompt rows and the recording must tell the same story: the
    // number of seam prompt-addition rows equals the number of sections found
    // in the delta (already asserted section-by-section above; this keeps the
    // recorded list tied to 1.2's derived enumeration).
    const seamPromptRows = seamRows.filter((row) => row.kind === "prompt-addition");
    expect(seamPromptRows).toHaveLength(seamSections.length);
  });
});
