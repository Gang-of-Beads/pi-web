import { describe, expect, it } from "vitest";
import {
  readChatHistoryWatermark,
  removeChatHistoryWatermark,
  writeChatHistoryWatermark,
  type HistoryStorage,
} from "./chatHistoryCache";

function memoryStorage(): HistoryStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    keys: () => [...map.keys()],
  };
}

describe("chat history watermark", () => {
  it("round-trips the seq a cached page is current through", () => {
    const storage = memoryStorage();
    expect(readChatHistoryWatermark("s1", storage)).toBeUndefined();
    writeChatHistoryWatermark("s1", 41, storage);
    expect(readChatHistoryWatermark("s1", storage)).toBe(41);
    removeChatHistoryWatermark("s1", storage);
    expect(readChatHistoryWatermark("s1", storage)).toBeUndefined();
  });

  it("reads a corrupt or non-numeric watermark as absent", () => {
    const storage = memoryStorage();
    storage.setItem("pi-web:chat-watermark:v1:s1", "not json");
    expect(readChatHistoryWatermark("s1", storage)).toBeUndefined();
    storage.setItem("pi-web:chat-watermark:v1:s1", JSON.stringify("41"));
    expect(readChatHistoryWatermark("s1", storage)).toBeUndefined();
  });
});
