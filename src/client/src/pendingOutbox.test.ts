import { describe, expect, it } from "vitest";
import { advancePendingPrompt, clearPendingPrompts, forgetReservedPrompt, reserveAcceptedPrompt, restoreRefusedPrompt, isNetworkFailure, loadPendingPrompts, moveOutbox, NetworkSendError, savePendingPrompt, sessionsWithFailedSends, type PendingPrompt } from "./pendingOutbox";

function memoryStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get length() { return data.size; },
    clear: () => { data.clear(); },
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key); },
    setItem: (key: string, value: string) => { data.set(key, value); },
  };
}

describe("pendingOutbox", () => {
  it("persists and reloads pending prompts per session key", () => {
    const storage = memoryStorage();
    savePendingPrompt("key-a", { text: "first", behavior: "steer", at: "2026-08-19T00:00:00.000Z" }, storage);
    savePendingPrompt("key-a", { text: "second", at: "2026-08-19T00:00:01.000Z" }, storage);
    savePendingPrompt("key-b", { text: "other", at: "2026-08-19T00:00:02.000Z" }, storage);

    expect(loadPendingPrompts("key-a", storage).map((p) => p.text)).toEqual(["first", "second"]);
    expect(loadPendingPrompts("key-b", storage).map((p) => p.text)).toEqual(["other"]);
  });

  it("clears all pending prompts for a key", () => {
    const storage = memoryStorage();
    savePendingPrompt("key-a", { text: "first", at: "2026-08-19T00:00:00.000Z" }, storage);
    clearPendingPrompts("key-a", storage);
    expect(loadPendingPrompts("key-a", storage)).toEqual([]);
  });

  it("tolerates corrupt storage", () => {
    const storage = memoryStorage();
    storage.setItem("pi-web:pending-prompt:bad", "{not json");
    expect(loadPendingPrompts("bad", storage)).toEqual([]);
  });

  it("classifies network failures", () => {
    expect(isNetworkFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkFailure(new TypeError("NetworkError when attempting to fetch resource."))).toBe(true);
    expect(isNetworkFailure(new Error("ECONNREFUSED connect"))).toBe(true);
    expect(isNetworkFailure(new Error("400 Bad Request"))).toBe(false);
    expect(isNetworkFailure(new Error("boom"))).toBe(false);
    expect(isNetworkFailure(new NetworkSendError("boom", "cm-1", { cause: new Error("boom") }))).toBe(true);
  });

  it("round-trips a full PendingPrompt", () => {
    const storage = memoryStorage();
    const prompt: PendingPrompt = { text: "hello", behavior: "followUp", at: "2026-08-19T01:00:00.000Z" };
    savePendingPrompt("k", prompt, storage);
    expect(loadPendingPrompts("k", storage)).toEqual([prompt]);
  });

  // A retry that failed again saves the same message. Appending would build a
  // duplicate entry per failed attempt; replacing keeps one line per message.
  it("replaces a pending prompt that shares its correlation id", () => {
    const storage = memoryStorage();
    savePendingPrompt("k", { text: "first", clientMessageId: "cm-1", at: "2026-08-19T01:00:00.000Z" }, storage);
    savePendingPrompt("k", { text: "first again", clientMessageId: "cm-1", at: "2026-08-19T02:00:00.000Z" }, storage);
    savePendingPrompt("k", { text: "another", at: "2026-08-19T03:00:00.000Z" }, storage);

    expect(loadPendingPrompts("k", storage)).toEqual([
      { text: "first again", clientMessageId: "cm-1", at: "2026-08-19T02:00:00.000Z" },
      { text: "another", at: "2026-08-19T03:00:00.000Z" },
    ]);
  });

  it("keeps the correlation id when the retry fails again", () => {
    const storage = memoryStorage();
    const original = { text: "stay", clientMessageId: "cm-9", at: "2026-08-19T01:00:00.000Z" };
    savePendingPrompt("k", original, storage);
    savePendingPrompt("k", { text: "stay", clientMessageId: "cm-9", at: "2026-08-19T02:00:00.000Z" }, storage);
    expect(loadPendingPrompts("k", storage)).toEqual([{ text: "stay", clientMessageId: "cm-9", at: "2026-08-19T02:00:00.000Z" }]);
  });
});
describe("a retried message keeps what was attached to it", () => {
  /**
   * The outbox stored only text, and the replay sent only text, so a message
   * that carried a screenshot came back as prose about a screenshot nobody
   * could see. Nothing said so: the bubble replayed, the send succeeded, and
   * the image was simply not there.
   */
  it("round-trips attachments through storage", () => {
    const storage = new MemoryStorage();
    const attachment = { kind: "file" as const, name: "shot.png", mimeType: "image/png", data: "AAAA" };

    savePendingPrompt("k", { text: "look at this", at: "2026-08-26T10:00:00.000Z", attachments: [attachment] }, storage);

    const [restored] = loadPendingPrompts("k", storage);
    expect(restored?.attachments).toEqual([attachment]);
  });

  it("still reads an entry saved before attachments were stored", () => {
    const storage = new MemoryStorage();
    storage.setItem("pi-web:pending-prompt:k", JSON.stringify([{ text: "older", at: "2026-08-26T10:00:00.000Z" }]));

    const [restored] = loadPendingPrompts("k", storage);
    expect(restored?.text).toBe("older");
    expect(restored?.attachments).toBeUndefined();
  });
});

class MemoryStorage implements Storage {
  private readonly map = new Map<string, string>();
  get length(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  getItem(key: string): string | null { return this.map.get(key) ?? null; }
  key(index: number): string | null { return [...this.map.keys()][index] ?? null; }
  removeItem(key: string): void { this.map.delete(key); }
  setItem(key: string, value: string): void { this.map.set(key, value); }
}

describe("moveOutbox", () => {
  it("carries a session's unsent records to its new identity, keeping each identity once", () => {
    const storage = memoryStorage();
    savePendingPrompt("local:pending-1", { text: "a", clientMessageId: "cm-a", at: "2026-09-29T00:00:00.000Z" }, storage);
    savePendingPrompt("local:pending-1", { text: "b", clientMessageId: "cm-b", at: "2026-09-29T00:00:01.000Z", state: "failed" }, storage);
    savePendingPrompt("local:started-1", { text: "a", clientMessageId: "cm-a", at: "2026-09-29T00:00:00.000Z" }, storage);

    moveOutbox("local:pending-1", "local:started-1", storage);

    expect({
      moved: loadPendingPrompts("local:started-1", storage).map((prompt) => [prompt.clientMessageId, prompt.state]),
      left: loadPendingPrompts("local:pending-1", storage),
    }).toEqual({ moved: [["cm-a", undefined], ["cm-b", "failed"]], left: [] });
  });
});

describe("a record written by an earlier build", () => {
  it("keeps its meaning: an unverified record still reads as unanswered and still marks its session", () => {
    const storage = memoryStorage();
    storage.setItem("pi-web:pending-prompt:local:session-old", JSON.stringify([{ text: "a", clientMessageId: "cm-old", state: "unverified", at: "2026-09-01T00:00:00.000Z" }]));

    expect({ state: loadPendingPrompts("local:session-old", storage)[0]?.state, marked: [...sessionsWithFailedSends(storage)] })
      .toEqual({ state: "unverifiable", marked: ["session-old"] });
  });
});

describe("a record that fails", () => {
  it("records why, and forgets why once it moves on", () => {
    savePendingPrompt("local:session-f", { text: "a", clientMessageId: "cm-f", at: new Date().toISOString() });
    advancePendingPrompt("local:session-f", "cm-f", "send-refused-network");
    const failed = loadPendingPrompts("local:session-f")[0];
    advancePendingPrompt("local:session-f", "cm-f", "retry");
    const retried = loadPendingPrompts("local:session-f")[0];
    clearPendingPrompts("local:session-f");

    expect({ failed: [failed?.state, failed?.failure], retried: [retried?.state, retried?.failure] }).toEqual({ failed: ["failed", "not-sent"], retried: ["sending", undefined] });
  });
});

describe("an accepted message kept aside for a refusal", () => {
  const at = Date.parse("2026-09-30T00:00:00.000Z");
  const record = (id: string): PendingPrompt => ({ text: `words ${id}`, clientMessageId: id, at: "2026-09-30T00:00:00.000Z", attachments: [] });

  it("leaves the outbox, comes back failed on a refusal, and is gone once the agent took it or a day passed", () => {
    const storage = memoryStorage();
    for (const id of ["refused", "taken", "old"]) savePendingPrompt("m:s", record(id), storage);
    for (const id of ["refused", "taken", "old"]) reserveAcceptedPrompt("m:s", id, storage, at);
    const outboxAfterAcceptance = loadPendingPrompts("m:s", storage).length;
    forgetReservedPrompt("m:s", "taken", storage, at);

    expect({
      outboxAfterAcceptance,
      refused: restoreRefusedPrompt("m:s", "refused", storage, at),
      taken: restoreRefusedPrompt("m:s", "taken", storage, at),
      oldAfterADay: restoreRefusedPrompt("m:s", "old", storage, at + 24 * 60 * 60 * 1000),
      outbox: loadPendingPrompts("m:s", storage).map((entry) => [entry.clientMessageId, entry.state, entry.failure, entry.text]),
    }).toEqual({ outboxAfterAcceptance: 0, refused: true, taken: false, oldAfterADay: false, outbox: [["refused", "failed", "not-sent", "words refused"]] });
  });

  it("moves with its session to the session's new identity", () => {
    const storage = memoryStorage();
    savePendingPrompt("m:old", record("moving"), storage);
    reserveAcceptedPrompt("m:old", "moving", storage, at);
    moveOutbox("m:old", "m:new", storage, at);

    expect({ old: restoreRefusedPrompt("m:old", "moving", storage, at), moved: restoreRefusedPrompt("m:new", "moving", storage, at) }).toEqual({ old: false, moved: true });
  });
});
