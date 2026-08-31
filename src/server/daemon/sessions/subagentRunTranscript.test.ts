import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { branchMessages } from "./branchMessages";
import { isSubagentEventLog, runTranscriptMessages, subagentEventLogMessages } from "./subagentRunTranscript";

/**
 * A real fork-context transcript, copied from a live run and trimmed to one of
 * each record kind with a tool call and its result left paired. Hand-writing
 * this fixture is what hid the bug in the first place: an invented line that
 * merely carried `recordType` satisfied the locator test while the projection
 * was never exercised, so the fixture agreed with the assumption instead of
 * with the disk. Home paths are replaced; nothing else is altered.
 */
const FIXTURE = join(__dirname, "../../../../test-fixtures/subagent-run-transcript/fork-context.jsonl");

async function forkTranscriptEntries(): Promise<unknown[]> {
  const text = await readFile(FIXTURE, "utf8");
  const entries: unknown[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    entries.push(JSON.parse(line));
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const field: unknown = value[key];
  return typeof field === "string" ? field : undefined;
}

const roleOf = (message: unknown): string | undefined => stringField(message, "role");
const recordTypeOf = (entry: unknown): string | undefined => stringField(entry, "recordType");

describe("telling the two transcript formats apart", () => {
  it("recognises the subagent tool's event log", async () => {
    expect(isSubagentEventLog(await forkTranscriptEntries())).toBe(true);
  });

  it("does not mistake a session branch for one", () => {
    const branch = [
      { type: "session", id: "child" },
      { type: "message", message: { role: "user", content: "go" } },
    ];

    expect(isSubagentEventLog(branch)).toBe(false);
  });
});

describe("reading a fork-context child's conversation", () => {
  /**
   * The regression this guards: projected as a session branch, a real fork
   * transcript of 254 entries produced zero messages, because these records
   * carry no `type` and no session envelope.
   */
  it("yields the conversation a session walk cannot see", async () => {
    const entries = await forkTranscriptEntries();

    expect(branchMessages(entries)).toHaveLength(0);
    expect(subagentEventLogMessages(entries).length).toBeGreaterThan(0);
  });

  it("returns the messages in the shape the chat view renders", async () => {
    const messages = subagentEventLogMessages(await forkTranscriptEntries());

    expect(messages.map(roleOf)).toEqual(["user", "assistant", "toolResult"]);
  });

  /**
   * `tool_start` and `tool_end` describe the same tool call the assistant
   * message already carries and the result message already reports, so
   * rendering them too would show every call three times.
   */
  it("does not repeat the tool lifecycle the messages already carry", async () => {
    const entries = await forkTranscriptEntries();
    const lifecycle = entries.filter((entry) => recordTypeOf(entry) === "tool_start" || recordTypeOf(entry) === "tool_end");

    expect(lifecycle.length).toBeGreaterThan(0);
    expect(subagentEventLogMessages(entries)).toHaveLength(entries.length - lifecycle.length);
  });

  /**
   * The runner complaining is not the child speaking, but dropping it would
   * make the conversation quietly incomplete - worse than the text blob it
   * replaces, because a conversation claims to be the whole story.
   */
  it("shows what the runner said on stderr rather than dropping it", () => {
    const messages = subagentEventLogMessages([
      { recordType: "stderr", text: "Agent is already processing." },
    ]);

    expect(messages).toEqual([{ role: "system", source: "subagent_stderr", content: "Agent is already processing." }]);
  });

  it("falls back to the flat text when a record carries no nested message", () => {
    const messages = subagentEventLogMessages([
      { recordType: "message", role: "assistant", text: "said something" },
    ]);

    expect(messages).toEqual([{ role: "assistant", content: "said something" }]);
  });

  it("ignores a line that is not a record", () => {
    expect(subagentEventLogMessages([null, "text", 7])).toEqual([]);
  });
});

/**
 * The caller reads a file without knowing which kind of child wrote it, so this
 * is where the two formats are told apart. Pinned here because routing a fork
 * transcript through the session walk is silent: it yields an empty
 * conversation rather than an error.
 */
describe("choosing how to read a run's transcript", () => {
  it("reads a fork transcript with the adapter, not the session walk", async () => {
    const entries = await forkTranscriptEntries();

    const messages = runTranscriptMessages(entries, branchMessages);

    expect(messages.length).toBeGreaterThan(0);
    expect(messages).toEqual(subagentEventLogMessages(entries));
  });

  it("still reads a session file with the session walk", () => {
    const branch = [
      { type: "message", message: { role: "user", content: "go" } },
      { type: "message", message: { role: "assistant", content: "done" } },
    ];

    expect(runTranscriptMessages(branch, branchMessages)).toEqual(branchMessages(branch));
  });
});
