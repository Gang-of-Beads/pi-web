// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  classifySettlement, isSettled, resendIsTriviallySafe, settlementSentence,
  type AmbiguityReason, type OperationSettlement, type RefusalReason,
} from "./operationSettlement.js";

const REFUSAL_REASONS: RefusalReason[] = ["rejected-by-server", "invalid-request", "not-permitted", "session-gone"];
const AMBIGUITY_REASONS: AmbiguityReason[] = ["no-answer-within-deadline", "link-lost-in-flight", "link-offline", "answer-unreadable"];

describe("classifySettlement", () => {
  it("accepts only when the server said so", () => {
    expect(classifySettlement({ answer: "accepted", bytesHandedToTransport: true })).toEqual({ outcome: "accepted" });
  });

  it("refuses only with a reason, and treats a reasonless refusal as ambiguous", () => {
    for (const reason of REFUSAL_REASONS) {
      expect(classifySettlement({ answer: "refused", refusalReason: reason, bytesHandedToTransport: true }))
        .toEqual({ outcome: "refused", reason });
    }
    expect(classifySettlement({ answer: "refused", bytesHandedToTransport: true }))
      .toEqual({ outcome: "unverifiable", reason: "answer-unreadable", bytesHandedToTransport: true });
  });

  it("carries whether the bytes left, for every ambiguity", () => {
    for (const reason of AMBIGUITY_REASONS) {
      for (const bytesHandedToTransport of [true, false]) {
        expect(classifySettlement({ ambiguity: reason, bytesHandedToTransport }))
          .toEqual({ outcome: "unverifiable", reason, bytesHandedToTransport });
      }
    }
  });

  it("never reports a timeout as a refusal", () => {
    const settlement = classifySettlement({ ambiguity: "no-answer-within-deadline", bytesHandedToTransport: true });
    expect(settlement.outcome).toBe("unverifiable");
  });
});

describe("settlement predicates", () => {
  it("calls a resend trivially safe only when nothing left this process", () => {
    expect(resendIsTriviallySafe({ outcome: "unverifiable", reason: "link-offline", bytesHandedToTransport: false })).toBe(true);
    expect(resendIsTriviallySafe({ outcome: "unverifiable", reason: "link-lost-in-flight", bytesHandedToTransport: true })).toBe(false);
    expect(resendIsTriviallySafe({ outcome: "accepted" })).toBe(false);
  });

  it("treats only the two answered arms as settled", () => {
    expect(isSettled({ outcome: "accepted" })).toBe(true);
    expect(isSettled({ outcome: "refused", reason: "not-permitted" })).toBe(true);
    expect(isSettled({ outcome: "unverifiable", reason: "link-offline", bytesHandedToTransport: false })).toBe(false);
  });
});

describe("the fixed vocabulary", () => {
  it("gives every state exactly one sentence", () => {
    const settlements: OperationSettlement[] = [
      { outcome: "accepted" },
      ...REFUSAL_REASONS.map((reason): OperationSettlement => ({ outcome: "refused", reason })),
      ...AMBIGUITY_REASONS.map((reason): OperationSettlement => ({ outcome: "unverifiable", reason, bytesHandedToTransport: true })),
    ];
    const sentences = settlements.map((settlement) => settlementSentence(settlement));
    expect(sentences.every((sentence) => sentence.length > 0)).toBe(true);
    expect(new Set(sentences).size).toBe(sentences.length);
  });

  it("never uses a word that collapses ambiguity into an answer", () => {
    for (const reason of AMBIGUITY_REASONS) {
      const sentence = settlementSentence({ outcome: "unverifiable", reason, bytesHandedToTransport: true }).toLowerCase();
      expect(sentence).not.toContain("failed");
      expect(sentence).not.toContain("refused");
    }
  });
});
