import { describe, expect, it } from "vitest";
import { findDeliveryLineIndex, markDelivery, optimisticUserLine, restartDelivery } from "./messageDelivery";
import { loadPendingPrompts, savePendingPrompt, forgetPendingPrompt } from "./pendingOutbox";
import type { ChatLine } from "./components/shared";

const KEY = "machine-1::session-1";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => { map.clear(); },
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); },
  };
}

/**
 * The retry path only works when the outbox entry and the bubble carry the same
 * id. Two ids means the retry revives nothing, the failed bubble stays failed
 * forever, and the delivered message lands as a second row.
 */
describe("a message keeps one identity from composer to delivery", () => {
  it("revives the failed bubble when the retry uses the outbox id", () => {
    const storage = memoryStorage();
    const id = "cmid-1";
    savePendingPrompt(KEY, { text: "hello", clientMessageId: id, at: "2026-09-03T15:00:00.000Z" }, storage);

    let messages: ChatLine[] = [optimisticUserLine("hello", id)];
    messages = markDelivery(messages, id, "failed");
    expect(messages).toHaveLength(1);

    const entry = loadPendingPrompts(KEY, storage)[0];
    expect(entry?.clientMessageId).toBe(id);

    messages = restartDelivery(messages, entry?.clientMessageId ?? "");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.meta?.delivery?.state).toBe("sending");
  });

  it("leaves a second row behind when the ids differ", () => {
    const bubbleId = "cmid-bubble";
    const outboxId = "cmid-outbox";
    let messages: ChatLine[] = [optimisticUserLine("hello", bubbleId)];
    messages = markDelivery(messages, bubbleId, "failed");

    messages = restartDelivery(messages, outboxId);
    expect(messages[0]?.meta?.delivery?.state).toBe("failed");
    expect(findDeliveryLineIndex(messages, outboxId)).toBe(-1);
  });

  it("drops the entry by the same id once the message is accepted", () => {
    const storage = memoryStorage();
    const id = "cmid-2";
    savePendingPrompt(KEY, { text: "hello", clientMessageId: id, at: "2026-09-03T15:00:00.000Z" }, storage);
    forgetPendingPrompt(KEY, id, storage);
    expect(loadPendingPrompts(KEY, storage)).toHaveLength(0);
  });

  it("keeps an unrelated waiting entry when one is accepted", () => {
    const storage = memoryStorage();
    savePendingPrompt(KEY, { text: "first", clientMessageId: "a", at: "2026-09-03T15:00:00.000Z" }, storage);
    savePendingPrompt(KEY, { text: "second", clientMessageId: "b", at: "2026-09-03T15:00:01.000Z" }, storage);
    forgetPendingPrompt(KEY, "a", storage);
    expect(loadPendingPrompts(KEY, storage).map((entry) => entry.clientMessageId)).toStrictEqual(["b"]);
  });
});
