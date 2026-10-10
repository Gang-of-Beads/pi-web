import { describe, expect, it } from "vitest";
import { readableMessageCount } from "../server/daemon/sessions/readableMessageCount.js";
import { branchMessages, branchTranscript, transcriptHead } from "./branchMessages.js";

/**
 * Shaped after a real transcript (2026-09-29, 14:21-14:24): pi retried two
 * overloaded errors and the third was final. Each retried attempt is followed by a
 * `context_edit` that removes it from the model's context with no replacement.
 */
const failed = (id: string, text: string) => ({ type: "message", id, message: { role: "assistant", content: [], stopReason: "error", errorMessage: text } });
const omit = (id: string, targetId: string) => ({ type: "context_edit", id, targetId, replacement: null });
const branch = [
  { type: "message", id: "u1", message: { role: "user", content: "go" } },
  failed("a1", "overloaded"),
  omit("e1", "a1"),
  failed("a2", "overloaded"),
  omit("e2", "a2"),
  failed("a3", "overloaded, final"),
];
const errors = (messages: unknown[]): unknown[] => messages.flatMap((message): unknown[] => {
  const text: unknown = typeof message === "object" && message !== null ? Reflect.get(message, "errorMessage") : undefined;
  return text === undefined ? [] : [text];
});

describe("a turn the reader stopped, after a reload", () => {
  const stopped = { type: "custom", id: "s1", customType: "pi-web.turn.stopped", data: { by: "you" } };
  const cut = (id: string) => ({ type: "message", id, message: { role: "assistant", content: [], stopReason: "aborted", errorMessage: "Request aborted" } });
  const stoppedBy = (messages: unknown[]): unknown[] => messages.map((message): unknown => (typeof message === "object" && message !== null ? Reflect.get(message, "stoppedBy") : undefined));

  it("marks the reply the Stop cut", () => {
    expect(stoppedBy(branchMessages([{ type: "message", id: "u1", message: { role: "user", content: "go" } }, stopped, cut("a1")]))).toEqual([undefined, "you"]);
  });

  it("marks nothing in a later turn; a Stop no reply followed settles on its own", () => {
    const later = [stopped, { type: "message", id: "u2", message: { role: "user", content: "again" } }, cut("a2")];
    expect(stoppedBy(branchMessages(later))).toEqual(["you", undefined, undefined]);
  });

  /**
   * B30, review run 6cc25868: a Stop pressed while pi waited to retry a failed attempt writes no
   * reply at all - pi only ends the retry. A failure no retry replaced is never hidden, so the
   * failed attempt stays shown, followed by the Stop's own row, even with no unreplaced record
   * (a legacy file).
   */
  it("shows the failed attempt then the Stop's row when a Stop in the retry wait left no record", () => {
    const duringBackoff = [
      { type: "message", id: "u1", message: { role: "user", content: "go" } },
      { type: "message", id: "a1", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "503 overloaded" } },
      { type: "context_edit", id: "e1", targetId: "a1", replacement: null },
      { ...stopped, data: { by: "you", at: "2026-09-30T09:00:00.000Z" } },
    ];
    const transcript = branchTranscript(duringBackoff);
    expect(transcript.map((row) => row.entryId)).toEqual(["u1", "a1", "s1"]);
    expect(transcript[2]?.message).toEqual({ role: "assistant", content: [], stopReason: "aborted", stoppedBy: "you", timestamp: "2026-09-30T09:00:00.000Z" });
    expect(readableMessageCount(duringBackoff)).toBe(transcript.length);
  });

  it("marks only the first cut reply after the Stop", () => {
    expect(stoppedBy(branchMessages([stopped, cut("a1"), cut("a2")]))).toEqual(["you", undefined]);
  });
});

describe("retried attempts in the transcript", () => {
  it("shows only the failure no retry replaced", () => {
    expect(errors(branchMessages(branch))).toEqual(["overloaded, final"]);
  });

  it("keeps the sidebar count in step with the transcript", () => {
    expect(readableMessageCount(branch)).toBe(branchMessages(branch).length);
  });

  it("names the entry every message came from, in the same order", () => {
    const transcript = branchTranscript(branch);
    expect(transcript.map((row) => row.entryId)).toEqual(["u1", "a3"]);
    expect(transcript.map((row) => row.message)).toEqual(branchMessages(branch));
  });

  it("moves the head back when a retry removes the attempt it ended on", () => {
    const beforeRetry = [branch[0], failed("a1", "overloaded")];
    expect(transcriptHead(branchTranscript(beforeRetry))).toEqual({ n: 2, leaf: "a1" });
    expect(transcriptHead(branchTranscript([...beforeRetry, omit("e1", "a1")], undefined, new Set(["a1"])))).toEqual({ n: 1, leaf: "u1" });
  });

  it("has an empty head for an empty branch", () => {
    expect(transcriptHead(branchTranscript([]))).toEqual({ n: 0, leaf: null });
  });

  it("hides nothing an edit removed for another reason", () => {
    const trimmedUser = [{ type: "message", id: "u1", message: { role: "user", content: "go" } }, omit("e1", "u1")];
    const replaced = [failed("a1", "overloaded"), { type: "context_edit", id: "e1", targetId: "a1", replacement: { content: "summary" } }];
    expect(branchMessages(trimmedUser)).toHaveLength(1);
    expect(errors(branchMessages(replaced))).toEqual(["overloaded"]);
  });
});
