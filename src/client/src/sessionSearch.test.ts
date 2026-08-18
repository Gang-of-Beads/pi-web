import { describe, expect, it } from "vitest";
import type { SessionInfo } from "./api";
import { filterSessionRows, sessionMatchesSearch, shouldShowSessionSearch } from "./sessionSearch";

function session(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    path: `/repo/.pi/sessions/${id}.jsonl`,
    cwd: "/repo",
    persisted: true,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    messageCount: 1,
    firstMessage: "",
    ...overrides,
  };
}

describe("sessionMatchesSearch", () => {
  it("matches every session for an empty query", () => {
    expect(sessionMatchesSearch(session("a"), "")).toBe(true);
    expect(sessionMatchesSearch(session("a"), "   ")).toBe(true);
  });

  it("matches the session name case-insensitively", () => {
    expect(sessionMatchesSearch(session("a", { name: "Refactor Billing" }), "billing")).toBe(true);
    expect(sessionMatchesSearch(session("a", { name: "Refactor Billing" }), "invoices")).toBe(false);
  });

  it("matches the first message and the session id", () => {
    expect(sessionMatchesSearch(session("a", { firstMessage: "fix the websocket reconnect" }), "reconnect")).toBe(true);
    expect(sessionMatchesSearch(session("abc123"), "abc1")).toBe(true);
  });

  it("requires every whitespace-separated token to match", () => {
    const info = session("a", { name: "mobile layout", firstMessage: "tabs" });
    expect(sessionMatchesSearch(info, "mobile tabs")).toBe(true);
    expect(sessionMatchesSearch(info, "mobile desktop")).toBe(false);
  });

  it("falls back to subsequence matching for abbreviated typing", () => {
    expect(sessionMatchesSearch(session("a", { name: "prompt editor" }), "prmted")).toBe(true);
    expect(sessionMatchesSearch(session("a", { name: "prompt editor" }), "zzz")).toBe(false);
  });
});

describe("filterSessionRows", () => {
  const rows = [
    { session: session("root", { name: "root work" }), depth: 0 },
    { session: session("child", { name: "child billing" }), depth: 1 },
    { session: session("grandchild", { name: "grandchild invoices" }), depth: 2 },
    { session: session("other", { name: "unrelated" }), depth: 0 },
  ];

  it("returns every row for an empty query", () => {
    expect(filterSessionRows(rows, "").map((row) => row.session.id)).toEqual(["root", "child", "grandchild", "other"]);
  });

  it("keeps ancestors of a nested match as context", () => {
    expect(filterSessionRows(rows, "invoices").map((row) => row.session.id)).toEqual(["root", "child", "grandchild"]);
  });

  it("drops unrelated branches", () => {
    expect(filterSessionRows(rows, "billing").map((row) => row.session.id)).toEqual(["root", "child"]);
  });

  it("returns nothing when no session matches", () => {
    expect(filterSessionRows(rows, "zzzz")).toEqual([]);
  });
});

describe("shouldShowSessionSearch", () => {
  it("hides the field for short lists with no active query", () => {
    expect(shouldShowSessionSearch(4, "")).toBe(false);
  });

  it("shows the field once the list grows", () => {
    expect(shouldShowSessionSearch(5, "")).toBe(true);
  });

  it("keeps the field while a query is active, however short the list became", () => {
    expect(shouldShowSessionSearch(1, "bill")).toBe(true);
  });
});

describe("session id search", () => {
  const session = (id: string, firstMessage: string, path: string): SessionInfo => ({
    id, cwd: "/home/hanxiaodu", path, created: "", modified: "", messageCount: 0, firstMessage,
  });

  // Searching a session id prefix used to return nearly the whole list: the
  // matcher fell back to a plain subsequence over name + first message + id +
  // path, and a long UUID plus a path spells almost any short hex string.
  it("does not match unrelated sessions from a session id prefix", () => {
    const other = session(
      "01a00f62-1111-2222-3333-444444444444",
      "\u276f ssh hanxiaodu@100.100.1.1 Welcome to Ubuntu",
      "/home/hanxiaodu/.pi/sessions/01a00f62.jsonl",
    );
    expect(sessionMatchesSearch(other, "01a0136")).toBe(false);
  });

  // A session whose first message is a stack trace: 4000-odd characters of
  // file paths and line numbers contain "0", "1", "a", "3", "6" in order many
  // times over, so an id-shaped query matched a session it has nothing to do
  // with. Taken from a real session that showed up when searching "01a0136".
  it("does not treat an id-shaped query as an abbreviation of prose", () => {
    // Real stack traces run to thousands of characters of paths and line
    // numbers; this rebuilds that shape rather than pasting one session's data.
    const frame = (index: number) =>
      `    at refreshAnthropicToken (file:///home/u/.nvm/node/v24.13.1/lib/pi-ai/dist/auth/oauth/anthropic.js:${String(index)}:30)`;
    const stackTrace = [
      'Error: Anthropic account "personal" failed closed: token refresh failed.',
      "url=https://platform.claude.com/v1/oauth/token; details=TypeError: The",
      '"signals[0]" argument must be an instance of AbortSignal. Received undefined',
      ...Array.from({ length: 24 }, (_unused, index) => frame(100 + index * 37)),
    ].join("\n");

    const noisy = session(
      "01a00616-738e-76a6-a2bf-f0656c8021ec", stackTrace,
      "/home/hanxiaodu/.pi/agent/sessions/2026-08-15T15-42-03-696Z_01a00616.jsonl",
    );
    expect(sessionMatchesSearch(noisy, "01a0136")).toBe(false);
  });

  it("still matches the session whose id carries the prefix", () => {
    const target = session(
      "01a01367-aaaa-bbbb-cccc-dddddddddddd", "hi",
      "/home/hanxiaodu/.pi/sessions/01a01367.jsonl",
    );
    expect(sessionMatchesSearch(target, "01a0136")).toBe(true);
  });
});
