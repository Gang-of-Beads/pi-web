import { describe, expect, it } from "vitest";
import { TRANSCRIPT_PORT_NOT_READY, createSessionTranscriptPort, type TranscriptReader } from "./sessionTranscriptPort.js";

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
    expect(calls).toEqual([{ ref: { id: "s1", cwd: "/repo" }, page: { before: 5, limit: 1 } }]);
  });

  it("exposes no write path and cannot be extended by a plugin", () => {
    const port = createSessionTranscriptPort(() => reader());
    expect(Object.keys(port).sort()).toEqual(["listSessions", "readMessages"]);
    expect(Object.isFrozen(port)).toBe(true);
    expect(() => { Reflect.set(port, "writeMessages", () => undefined); }).not.toThrow();
    expect(Reflect.has(port, "writeMessages")).toBe(false);
  });
});
