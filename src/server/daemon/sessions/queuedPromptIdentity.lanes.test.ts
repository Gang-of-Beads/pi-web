import { describe, expect, it } from "vitest";
import { correlateQueuedPromptIds } from "./queuedPromptIdentity.js";

interface Entry {
  kind: string;
  text: string;
  clientMessageId?: string;
}

/**
 * The duplicate again, in the one arrangement position alone does not cover.
 *
 * The runtime keeps steering messages and follow-ups in separate queues, and
 * the status lists them lane by lane - every steer, then every follow-up.
 * Submissions are recorded in the order they arrive, whatever lane they went
 * into. Correlating across the whole list therefore swapped ids the moment both
 * lanes were in use: send a follow-up, then a steer, and the list puts the
 * steer first, so each entry took the other's id. Neither browser bubble could
 * be claimed and both messages were drawn twice.
 *
 * Reported from a session showing "Queued to steer" and "Queued" side by side.
 */

describe("correlating a queue that uses both lanes", () => {
  it("gives each lane its own submissions", () => {
    const queued = [{ kind: "steer", text: "expanded steer" }, { kind: "followUp", text: "expanded follow-up" }];
    const records = [
      { clientMessageId: "c-follow", text: "typed follow-up", kind: "followUp" },
      { clientMessageId: "c-steer", text: "typed steer", kind: "steer" },
    ];

    expect(correlateQueuedPromptIds(queued, records)).toEqual([
      { kind: "steer", text: "expanded steer", clientMessageId: "c-steer" },
      { kind: "followUp", text: "expanded follow-up", clientMessageId: "c-follow" },
    ]);
  });

  it("keeps submission order within a lane", () => {
    const queued: Entry[] = [{ kind: "followUp", text: "first" }, { kind: "followUp", text: "second" }];
    const records = [
      { clientMessageId: "c-1", text: "first typed", kind: "followUp" },
      { clientMessageId: "c-2", text: "second typed", kind: "followUp" },
    ];

    expect(correlateQueuedPromptIds(queued, records).map((entry) => entry.clientMessageId)).toEqual(["c-1", "c-2"]);
  });

  /** A record written before lanes were tracked is still usable, in order. */
  it("still correlates records that carry no lane", () => {
    const queued: Entry[] = [{ kind: "followUp", text: "a" }, { kind: "steer", text: "b" }];
    const records = [{ clientMessageId: "c-1", text: "a" }, { clientMessageId: "c-2", text: "b" }];

    expect(correlateQueuedPromptIds(queued, records).map((entry) => entry.clientMessageId)).toEqual(["c-1", "c-2"]);
  });

  it("leaves an entry alone when its lane has nothing left to give", () => {
    const queued: Entry[] = [{ kind: "steer", text: "s1" }, { kind: "steer", text: "s2" }];
    const records = [{ clientMessageId: "c-1", text: "s1", kind: "steer" }];

    expect(correlateQueuedPromptIds(queued, records).map((entry) => entry.clientMessageId)).toEqual(["c-1", undefined]);
  });

  it("does not reassign an id the sender already set", () => {
    const queued = [{ kind: "steer", text: "s", clientMessageId: "mine" }];
    const records = [{ clientMessageId: "other", text: "s", kind: "steer" }];

    expect(correlateQueuedPromptIds(queued, records)[0]?.clientMessageId).toBe("mine");
  });
});
