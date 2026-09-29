/* eslint-disable @typescript-eslint/consistent-type-assertions -- review repro fixture: stubs reach into private runtime shapes; rewritten as a permanent test when its phase removes it.fails */
import { describe, expect, it } from "vitest";
import { SessionEventHub } from "./sessionEventHub.js";

function delta(text: string) {
  return { type: "assistant.delta" as const, text };
}

describe("review-repro realtime: a watermark has no epoch", () => {
  it("an evicted ring restarts the seq space, and an old watermark then replays with a hole", () => {
    const hub = new SessionEventHub({ replaySessionLimit: 1 });
    for (let index = 1; index <= 5; index += 1) hub.publish("session-a", delta(`old-${String(index)}`));
    const clientWatermark = hub.currentSeq("session-a");
    expect(clientWatermark).toBe(5);
    hub.publish("session-b", delta("other session evicts session-a"));
    for (let index = 1; index <= 7; index += 1) hub.publish("session-a", delta(`new-${String(index)}`));
    const answer = hub.replaySince("session-a", clientWatermark);
    const texts = answer.frames.map((frame) => (JSON.parse(frame) as { text: string }).text);
    expect({ verdict: answer.verdict, texts }, "new-1..new-5 were never sent to this client; a replay that omits them is a silent hole").toEqual({ verdict: "resync", texts: [] });
  });

  it("a daemon restart does the same: the new instance answers a previous instance watermark as caught-up", () => {
    const before = new SessionEventHub();
    for (let index = 1; index <= 3; index += 1) before.publish("session-a", delta(`before-${String(index)}`));
    const clientWatermark = before.currentSeq("session-a");
    const after = new SessionEventHub();
    for (let index = 1; index <= 3; index += 1) after.publish("session-a", delta(`after-${String(index)}`));
    expect(after.replaySince("session-a", clientWatermark), "after-1..after-3 are unseen by the client").toEqual({ verdict: "resync", frames: [] });
  });
});
