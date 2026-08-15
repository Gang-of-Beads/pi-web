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
