import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSessionHeaderSummary } from "./sessionFileHeader.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "pi-web-session-header-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("readSessionHeaderSummary", () => {
  it("reads id, cwd, and parent session from a real session file header", async () => {
    const sessionFile = await sessionFileWithLines([
      { type: "session", version: 3, id: "child-id", cwd: "/srv/dev/pi-web-feature", parentSession: "/sessions/parent.jsonl" },
      { type: "model_change", id: "abc", parentId: null },
    ]);

    expect(await readSessionHeaderSummary(sessionFile)).toEqual({
      id: "child-id",
      cwd: "/srv/dev/pi-web-feature",
      parentSession: "/sessions/parent.jsonl",
    });
  });

  it("omits absent and empty optional fields", async () => {
    const sessionFile = await sessionFileWithLines([{ type: "session", version: 3, id: "root-id", cwd: "" }]);

    expect(await readSessionHeaderSummary(sessionFile)).toEqual({ id: "root-id" });
  });

  it("returns undefined for a missing file", async () => {
    expect(await readSessionHeaderSummary(join(tempDir, "absent.jsonl"))).toBeUndefined();
  });

  it("returns undefined when the first line is not valid JSON", async () => {
    const sessionFile = join(tempDir, "broken.jsonl");
    await writeFile(sessionFile, "not json\n", "utf8");

    expect(await readSessionHeaderSummary(sessionFile)).toBeUndefined();
  });

  it("returns undefined when the first line is not a session header", async () => {
    const sessionFile = await sessionFileWithLines([{ type: "model_change", id: "abc" }]);

    expect(await readSessionHeaderSummary(sessionFile)).toBeUndefined();
  });

  it("returns undefined when the header carries no session id", async () => {
    const sessionFile = await sessionFileWithLines([{ type: "session", version: 3, cwd: "/srv/dev/pi-web" }]);

    expect(await readSessionHeaderSummary(sessionFile)).toBeUndefined();
  });

  it("does not read beyond the header line of a large transcript", async () => {
    const sessionFile = join(tempDir, "large.jsonl");
    const header = JSON.stringify({ type: "session", version: 3, id: "big-id", cwd: "/srv/dev/pi-web" });
    const bulk = Array.from({ length: 500 }, (_unused, index) => JSON.stringify({ type: "message", id: String(index), text: "x".repeat(200) }));
    await writeFile(sessionFile, `${[header, ...bulk].join("\n")}\n`, "utf8");

    expect(await readSessionHeaderSummary(sessionFile)).toEqual({ id: "big-id", cwd: "/srv/dev/pi-web" });
  });
});

async function sessionFileWithLines(lines: readonly Record<string, unknown>[]): Promise<string> {
  const sessionFile = join(tempDir, `session-${String(lines.length)}-${Math.random().toString(36).slice(2)}.jsonl`);
  await writeFile(sessionFile, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  return sessionFile;
}
