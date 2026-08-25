import { describe, expect, it } from "vitest";
import { clearPendingPrompts, isNetworkFailure, loadPendingPrompts, NetworkSendError, savePendingPrompt, type PendingPrompt } from "./pendingOutbox";

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