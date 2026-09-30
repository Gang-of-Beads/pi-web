import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { SessionManager, parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { branchFromFileEntries, isCurrentVersionFile } from "./fileBranch.js";

const header = { type: "session", version: 3, id: "session-1", cwd: "/repo" };
const idOf = (entry: unknown): unknown => (typeof entry === "object" && entry !== null ? Reflect.get(entry, "id") : undefined);
const message = (id: string, parentId: string | null, text: string) => ({ type: "message", id, parentId, message: { role: "user", content: text } });

describe("the branch a session file loads as (the SDK's rule)", () => {
  it("is every entry of a file that never branched, header excluded, in order", () => {
    const entries = [header, message("a", null, "one"), message("b", "a", "two"), message("c", "b", "three")];

    expect(branchFromFileEntries(entries).map(idOf)).toEqual(["a", "b", "c"]);
  });

  it("follows the last entry's parents, so an abandoned branch is not part of it", () => {
    const entries = [
      header,
      message("a", null, "one"),
      message("b", "a", "abandoned"),
      message("c", "b", "abandoned too"),
      { type: "branch_summary", id: "s", parentId: "a", summary: "went back" },
      message("d", "s", "the branch in use"),
    ];

    expect(branchFromFileEntries(entries).map(idOf)).toEqual(["a", "s", "d"]);
  });

  it("agrees with the SDK's own load of the same file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pi-web-file-branch-"));
    try {
      const path = join(dir, "session.jsonl");
      const lines = [
        { ...header, version: 3, timestamp: "2026-01-01T00:00:00.000Z" },
        { ...message("a", null, "one"), timestamp: "2026-01-01T00:00:01.000Z" },
        { ...message("b", "a", "abandoned"), timestamp: "2026-01-01T00:00:02.000Z" },
        { type: "branch_summary", id: "s", parentId: "a", timestamp: "2026-01-01T00:00:03.000Z", fromId: "b", summary: "went back" },
        { ...message("d", "s", "the branch in use"), timestamp: "2026-01-01T00:00:04.000Z" },
      ];
      const text = `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`;
      await writeFile(path, text, "utf8");

      const sdk = SessionManager.open(path, dirname(path)).getBranch().map(idOf);

      expect(branchFromFileEntries(parseSessionEntries(text)).map(idOf)).toEqual(sdk);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reads only a file of the current version as it stands", () => {
    expect([
      isCurrentVersionFile([{ ...header, version: 3 }], 3),
      isCurrentVersionFile([{ ...header, version: 2 }], 3),
      isCurrentVersionFile([{ type: "session", id: "s" }], 3),
      isCurrentVersionFile([message("a", null, "no header")], 3),
    ]).toEqual([true, false, false, false]);
  });

  it("is empty for a file with only its header, or nothing", () => {
    expect([branchFromFileEntries([header]), branchFromFileEntries([])]).toEqual([[], []]);
  });
});
