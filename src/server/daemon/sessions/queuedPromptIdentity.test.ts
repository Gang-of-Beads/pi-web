import { describe, expect, it } from "vitest";
import { correlateQueuedPromptIds, type QueuedPromptRecord } from "./queuedPromptIdentity.js";

/**
 * A queue entry and the bubble that sent it are correlated by identity, not by
 * comparing the text each of them happens to render.
 *
 * The browser mints a clientMessageId and sends it, but the runtime's queue
 * does not carry it, so the daemon used to re-attach it by matching
 * `record.text === message.text`. That works only while both sides render the
 * same string, and they routinely do not:
 *
 *   - the runtime expands `/skill` and prompt templates before queueing, so the
 *     committed text is not the typed text;
 *   - a prompt whose payload is an attachment carries little or no text at all,
 *     and an empty string matches every other empty string.
 *
 * Each failure leaves the entry without an id, the browser cannot claim its own
 * bubble, and a second row is synthesised for a message already on screen. The
 * owner reported that duplicate five times; every previous fix closed one way
 * for the texts to differ rather than the reliance on them being equal.
 *
 * Prompts enter the queue in the order they were submitted and leave it in the
 * same order, so position is the correlation the runtime does preserve.
 */

function record(clientMessageId: string, text: string): QueuedPromptRecord {
  return { clientMessageId, text };
}

describe("correlating queued prompts with the ids their senders minted", () => {
  it("pairs them in submission order, whatever the text became", () => {
    const queued: { text: string; clientMessageId?: string }[] = [{ text: "expanded by the runtime" }, { text: "" }];

    const paired = correlateQueuedPromptIds(queued, [record("c1", "/skill x"), record("c2", "look at this")]);

    expect(paired.map((entry) => entry.clientMessageId)).toEqual(["c1", "c2"]);
  });

  it("still pairs an attachment-only prompt, which carries no text to match on", () => {
    const paired = correlateQueuedPromptIds<{ text: string; clientMessageId?: string }>([{ text: "" }], [record("c1", "")]);

    expect(paired[0]?.clientMessageId).toBe("c1");
  });

  it("leaves entries this browser did not send without an id", () => {
    const paired = correlateQueuedPromptIds<{ text: string; clientMessageId?: string }>([{ text: "from another client" }], []);

    expect(paired[0]?.clientMessageId).toBeUndefined();
  });

  /** Fewer records than entries: only the ones this browser sent are claimed. */
  it("claims from the front when the queue also holds another sender's prompts", () => {
    const paired = correlateQueuedPromptIds<{ text: string; clientMessageId?: string }>([{ text: "mine" }, { text: "theirs" }], [record("c1", "mine")]);

    expect(paired.map((entry) => entry.clientMessageId)).toEqual(["c1", undefined]);
  });

  it("never gives one id to two entries", () => {
    const paired = correlateQueuedPromptIds<{ text: string; clientMessageId?: string }>([{ text: "same" }, { text: "same" }], [record("c1", "same")]);

    expect(paired.filter((entry) => entry.clientMessageId === "c1")).toHaveLength(1);
  });

  it("keeps an id already present rather than overwriting it", () => {
    const paired = correlateQueuedPromptIds([{ text: "x", clientMessageId: "existing" }], [record("c1", "x")]);

    expect(paired[0]?.clientMessageId).toBe("existing");
  });

  it("returns the queue untouched when nothing was recorded", () => {
    const queued = [{ text: "a" }];

    expect(correlateQueuedPromptIds(queued, [])).toEqual(queued);
  });
});
