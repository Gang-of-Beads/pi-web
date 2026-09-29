import { describe, expect, it } from "vitest";
import { readableMessageCount } from "../server/daemon/sessions/readableMessageCount.js";
import { branchMessages } from "./branchMessages.js";

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

describe("retried attempts in the transcript", () => {
  it("shows only the failure no retry replaced", () => {
    expect(errors(branchMessages(branch))).toEqual(["overloaded, final"]);
  });

  it("keeps the sidebar count in step with the transcript", () => {
    expect(readableMessageCount(branch)).toBe(branchMessages(branch).length);
  });

  it("hides nothing an edit removed for another reason", () => {
    const trimmedUser = [{ type: "message", id: "u1", message: { role: "user", content: "go" } }, omit("e1", "u1")];
    const replaced = [failed("a1", "overloaded"), { type: "context_edit", id: "e1", targetId: "a1", replacement: { content: "summary" } }];
    expect(branchMessages(trimmedUser)).toHaveLength(1);
    expect(errors(branchMessages(replaced))).toEqual(["overloaded"]);
  });
});
