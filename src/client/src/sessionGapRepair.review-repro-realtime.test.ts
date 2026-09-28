import { describe, expect, it } from "vitest";
import type { SessionUiEvent } from "../../shared/apiTypes";
import { SessionGapRepair } from "./sessionGapRepair";

function frame(seq: number): SessionUiEvent {
  return { type: "assistant.delta", text: String(seq), seq };
}

describe("review-repro realtime: a repair flushes held frames in arrival order, not seq order", () => {
  it.fails("two frames that arrive swapped during a repair are applied swapped", async () => {
    const applied: number[] = [];
    const repair = new SessionGapRepair({
      apply: (event) => { applied.push(Number(Reflect.get(event, "seq"))); },
      request: () => Promise.resolve({ ok: true, frames: [frame(10), frame(11)] }),
      resync: () => undefined,
    });
    repair.onLiveFrame(frame(9), 9);
    const repairing = repair.onGap(9);
    repair.onLiveFrame(frame(11), 11);
    repair.onLiveFrame(frame(10), 10);
    await repairing;
    expect(applied, "the replay itself carried 10 then 11; the held copies win and keep the wire arrival order").toEqual([9, 10, 11]);
  });

  it.fails("applied seqs survive a reconnect into a restarted seq space, so the new instance replay is discarded as already seen", async () => {
    const applied: string[] = [];
    const replayFrames: SessionUiEvent[] = [2, 3].map((seq) => ({ type: "assistant.delta", text: `new-${String(seq)}`, seq }));
    const repair = new SessionGapRepair({
      apply: (event) => { applied.push(String(Reflect.get(event, "text"))); },
      request: () => Promise.resolve({ ok: true, frames: replayFrames }),
      resync: () => undefined,
    });
    for (let seq = 1; seq <= 5; seq += 1) repair.onLiveFrame({ type: "assistant.delta", text: `old-${String(seq)}`, seq }, seq);
    applied.length = 0;
    repair.onLiveFrame({ type: "assistant.delta", text: "new-1", seq: 1 }, 1);
    const repairing = repair.onGap(1);
    repair.onLiveFrame({ type: "assistant.delta", text: "new-4", seq: 4 }, 4);
    await repairing;
    expect(applied, "after a daemon restart the socket reconnects on the same selection; seq 2..4 are new frames").toEqual(["new-1", "new-2", "new-3", "new-4"]);
  });
});
