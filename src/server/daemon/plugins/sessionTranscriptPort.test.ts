import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PORT_PAGE_LIMIT, TRANSCRIPT_PORT_NOT_READY, createSessionTranscriptPort, type TranscriptReader } from "./sessionTranscriptPort.js";

const session = { id: "s1", cwd: "/repo", path: "/store/s1.jsonl", name: "Fix login", created: "2026-09-01T00:00:00.000Z", modified: "2026-09-02T00:00:00.000Z", messageCount: 3, firstMessage: "hi", archived: false } as const;

function reader(overrides: Partial<TranscriptReader> = {}): TranscriptReader {
  return {
    list: () => Promise.resolve([session]),
    messages: () => Promise.resolve({ messages: [{ role: "user", content: "hi" }], start: 0, total: 1 }),
    ...overrides,
  };
}

describe("session transcript port", () => {
  it("refuses reads with a named error until the session service exists, never an empty answer", async () => {
    const port = createSessionTranscriptPort(() => undefined);
    await expect(port.listSessions("/repo")).rejects.toThrow(TRANSCRIPT_PORT_NOT_READY);
    await expect(port.readMessages({ id: "s1", cwd: "/repo" })).rejects.toThrow(TRANSCRIPT_PORT_NOT_READY);
  });

  it("resolves the reader late, so a port frozen at activation reads the service built afterwards", async () => {
    const holder: { current: TranscriptReader | undefined } = { current: undefined };
    const port = createSessionTranscriptPort(() => holder.current);
    holder.current = reader();
    await expect(port.listSessions("/repo")).resolves.toEqual([
      { id: "s1", cwd: "/repo", name: "Fix login", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-02T00:00:00.000Z", archived: false },
    ]);
  });

  it("hands the page through in the browser projection with the session's own scope", async () => {
    const calls: unknown[] = [];
    const port = createSessionTranscriptPort(() => reader({ messages: (ref, page) => { calls.push({ ref, page }); return Promise.resolve({ messages: ["m"], start: 4, total: 9 }); } }));
    await expect(port.readMessages({ id: "s1", cwd: "/repo" }, { before: 5, limit: 1 })).resolves.toEqual({ messages: ["m"], start: 4, total: 9 });
    expect(calls).toEqual([{ ref: { id: "s1", cwd: resolve("/repo") }, page: { before: 5, limit: 1 } }]);
  });

  it("sizes an unsized read as a page, never the whole transcript", async () => {
    const calls: unknown[] = [];
    const port = createSessionTranscriptPort(() => reader({ messages: (_ref, page) => { calls.push(page); return Promise.resolve({ messages: [], start: 0, total: 0 }); } }));
    await port.readMessages({ id: "s1", cwd: "/repo" });
    expect(calls).toEqual([{ limit: DEFAULT_PORT_PAGE_LIMIT }]);
  });

  it("normalizes the working directory like a browser request and refuses a relative one", async () => {
    const calls: string[] = [];
    const port = createSessionTranscriptPort(() => reader({ list: (cwd) => { calls.push(cwd); return Promise.resolve([]); } }));
    await port.listSessions("/repo/../repo/");
    expect(calls).toEqual([resolve("/repo")]);
    await expect(port.listSessions("relative/dir")).rejects.toThrow(/absolute/u);
  });

  it("strips provider-only thinking data the way the browser route does", async () => {
    const port = createSessionTranscriptPort(() => reader({ messages: () => Promise.resolve({ messages: [{ role: "assistant", content: [{ type: "thinking", thinking: "t", thinkingSignature: "sig" }] }], start: 0, total: 1 }) }));
    const page = await port.readMessages({ id: "s1", cwd: "/repo" });
    expect(JSON.stringify(page)).not.toContain("thinkingSignature");
  });

  it("answers undefined for a session file that is gone, not an empty page", async () => {
    const port = createSessionTranscriptPort(() => reader({ messages: () => Promise.resolve(undefined) }));
    await expect(port.readMessages({ id: "gone", cwd: "/repo" })).resolves.toBeUndefined();
  });

  it("exposes no write path and cannot be extended by a plugin", () => {
    const port = createSessionTranscriptPort(() => reader());
    expect(Object.keys(port).sort()).toEqual(["listSessions", "readMessages"]);
    expect(Object.isFrozen(port)).toBe(true);
    expect(() => { Reflect.set(port, "writeMessages", () => undefined); }).not.toThrow();
    expect(Reflect.has(port, "writeMessages")).toBe(false);
  });
});
