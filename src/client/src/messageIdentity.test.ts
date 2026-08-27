import { describe, expect, it } from "vitest";
import { indexOfIdentity, messageIdentity } from "./messageIdentity";
import type { ChatLine } from "./components/shared";

const at = (role: ChatLine["role"], timestamp: string, text = "hello"): ChatLine =>
  ({ role, parts: [{ type: "text", text }], meta: { timestamp } });

describe("what identifies a message", () => {
  /**
   * The browser's own send is identified by the id it minted, so the server's
   * echo and the agent's committed copy resolve to the same message rather
   * than to two.
   */
  it("prefers the id this browser minted", () => {
    const line: ChatLine = { role: "user", parts: [{ type: "text", text: "hi" }], meta: { timestamp: "t1", delivery: { clientMessageId: "cm-1", state: "sending" } } };

    expect(messageIdentity(line)).toBe("client:cm-1");
  });

  it("falls back to the moment it was recorded", () => {
    expect(messageIdentity(at("assistant", "2026-08-28T01:08:49.000Z"))).toBe("at:assistant:2026-08-28T01:08:49.000Z");
  });

  /**
   * Two replies a second apart are two messages; the same reply delivered
   * twice carries the same moment.
   */
  it("separates two replies and unites one delivered twice", () => {
    const first = at("assistant", "2026-08-28T01:08:49.000Z");
    const again = at("assistant", "2026-08-28T01:08:49.000Z");
    const later = at("assistant", "2026-08-28T01:09:30.000Z");

    expect(messageIdentity(first)).toBe(messageIdentity(again));
    expect(messageIdentity(first)).not.toBe(messageIdentity(later));
  });

  /**
   * A line still being streamed has no moment yet, and claiming it repeats
   * something would be an invention.
   */
  it("has no identity for a line that carries none", () => {
    expect(messageIdentity({ role: "assistant", parts: [{ type: "text", text: "partial" }] })).toBeUndefined();
  });

  it("finds where an identity already sits", () => {
    const transcript = [at("user", "t1"), at("assistant", "t2")];

    expect(indexOfIdentity(transcript, "at:assistant:t2")).toBe(1);
    expect(indexOfIdentity(transcript, "at:assistant:t9")).toBe(-1);
  });
});
