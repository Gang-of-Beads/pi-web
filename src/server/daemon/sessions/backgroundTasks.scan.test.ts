import { mkdtemp, appendFile, writeFile, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTranscriptScanCache, taskIdsForSession } from "./backgroundTasks.js";

/**
 * The transcript scan ran in full on every poll: a 169MB session file was
 * read into memory and regex-swept every few seconds, per session, forever -
 * the event loop stall behind "pi web is always stuck". A transcript only
 * grows, and bytes already scanned cannot produce new ids, so the scan keeps
 * a watermark per transcript and reads only what appeared since.
 */
function outputLine(id: string): string {
  return `Output: .pi/tasks/session-1-1/${id}.output\n`;
}

async function freshTranscript(lines: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bgscan-"));
  const path = join(dir, "session.jsonl");
  await writeFile(path, lines);
  return path;
}

beforeEach(() => {
  resetTranscriptScanCache();
});

describe("the incremental transcript scan", () => {
  it("finds the ids on first sight", async () => {
    const path = await freshTranscript(outputLine("aaa111") + outputLine("bbb222"));
    expect(await taskIdsForSession(path)).toEqual(new Set(["aaa111", "bbb222"]));
  });

  it("reads only the growth: a same-size rewrite is not rescanned", async () => {
    const path = await freshTranscript(outputLine("aaa111"));
    await taskIdsForSession(path);
    // Same byte length, different id. A full re-read would find the new id;
    // the watermark says these bytes were already scanned.
    await writeFile(path, outputLine("zzz999"));
    expect(await taskIdsForSession(path)).toEqual(new Set(["aaa111"]));
  });

  it("picks up ids appended after the first scan", async () => {
    const path = await freshTranscript(outputLine("aaa111"));
    await taskIdsForSession(path);
    await appendFile(path, outputLine("ccc333"));
    expect(await taskIdsForSession(path)).toEqual(new Set(["aaa111", "ccc333"]));
  });

  it("finds an id whose line spans the scanned boundary", async () => {
    const line = outputLine("ddd444");
    const cut = line.length - 8;
    const path = await freshTranscript(outputLine("aaa111") + line.slice(0, cut));
    await taskIdsForSession(path);
    await appendFile(path, line.slice(cut));
    expect(await taskIdsForSession(path)).toEqual(new Set(["aaa111", "ddd444"]));
  });

  it("rescans from the start when the file shrank", async () => {
    const path = await freshTranscript(outputLine("aaa111") + outputLine("bbb222"));
    await taskIdsForSession(path);
    await truncate(path, 0);
    await appendFile(path, outputLine("eee555"));
    expect(await taskIdsForSession(path)).toEqual(new Set(["eee555"]));
  });

  it("answers empty for a transcript that does not exist", async () => {
    expect(await taskIdsForSession("/nowhere/at/all.jsonl")).toEqual(new Set());
  });
});
