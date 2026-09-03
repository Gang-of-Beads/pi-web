import { describe, expect, it } from "vitest";
import { oneRowPerIdentity } from "./transcriptInvariant";
import type { ChatLine } from "./components/shared";

function user(text: string, meta?: ChatLine["meta"]): ChatLine {
  return { role: "user", parts: [{ type: "text", text }], ...(meta === undefined ? {} : { meta }) };
}

describe("oneRowPerIdentity", () => {
  it("collapses two rows sharing a client id and settles the receipt", () => {
    const tracked = user("steer me", { delivery: { clientMessageId: "c-1", state: "queued" } });
    const committed = user("steer me", { clientMessageId: "c-1", timestamp: "2026-09-04T00:00:00.000Z" });
    const out = oneRowPerIdentity([tracked, committed]);
    expect(out).toHaveLength(1);
    expect(out[0]?.meta?.delivery?.state).toBe("delivered");
  });

  it("collapses an echo with its committed copy and drops the echo mark", () => {
    const echo = user("hello", { echo: true, echoClientMessageId: "c-2" });
    const committed = user("hello", { clientMessageId: "c-2" });
    const out = oneRowPerIdentity([echo, committed]);
    expect(out).toHaveLength(1);
    expect(out[0]?.meta?.echo).toBeUndefined();
  });

  it("collapses an echoed captionless photo with its committed copy", () => {
    const parts: ChatLine["parts"] = [{ type: "image", mimeType: "image/png", data: "A".repeat(80) }];
    const echo: ChatLine = { role: "user", parts, meta: { echo: true } };
    const committed: ChatLine = { role: "user", parts };
    expect(oneRowPerIdentity([echo, committed])).toHaveLength(1);
  });

  it("keeps two plain identical photos apart", () => {
    const photo: ChatLine = { role: "user", parts: [{ type: "image", mimeType: "image/png", data: "A".repeat(80) }] };
    expect(oneRowPerIdentity([photo, { ...photo }])).toHaveLength(2);
  });

  it("keeps deliberate repeats: two plain rows with the same words", () => {
    const first = user("continue", { timestamp: "2026-09-03T10:00:00.000Z" });
    const second = user("continue", { timestamp: "2026-09-04T10:00:00.000Z" });
    expect(oneRowPerIdentity([first, second])).toHaveLength(2);
  });

  it("keeps distinct messages, same words different ids", () => {
    const first = user("continue", { delivery: { clientMessageId: "c-3", state: "delivered" } });
    const second = user("continue", { delivery: { clientMessageId: "c-4", state: "queued" } });
    expect(oneRowPerIdentity([first, second])).toHaveLength(2);
  });

  it("keeps the first row's position when a later twin collapses", () => {
    const tracked = user("mid turn", { delivery: { clientMessageId: "c-5", state: "queued" } });
    const reply: ChatLine = { role: "assistant", parts: [{ type: "text", text: "ok" }] };
    const twin = user("mid turn", { clientMessageId: "c-5" });
    const out = oneRowPerIdentity([tracked, reply, twin]);
    expect(out.map((line) => line.role)).toEqual(["user", "assistant"]);
  });

  it("never upgrades a failed delivery", () => {
    const failed = user("lost", { delivery: { clientMessageId: "c-6", state: "failed" } });
    const twin = user("lost", { clientMessageId: "c-6" });
    const out = oneRowPerIdentity([failed, twin]);
    expect(out[0]?.meta?.delivery?.state).toBe("failed");
  });
});
