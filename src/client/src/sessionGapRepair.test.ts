import { describe, expect, it, vi } from "vitest";
import type { SessionUiEvent } from "../../shared/apiTypes";
import { SessionGapRepair } from "./sessionGapRepair";

function frame(text: string, seq?: number): SessionUiEvent {
  return { type: "assistant.delta", text, ...(seq === undefined ? {} : { seq }) };
}

function seqSuffix(event: SessionUiEvent): string {
  const seq: unknown = Reflect.get(event, "seq");
  return typeof seq === "number" ? `@${String(seq)}` : "";
}

/** One repaired gap, recorded as the applied sequence of text@seq markers. */
function drive(options?: { request?: (sinceSeq: number) => Promise<{ ok: true; frames: SessionUiEvent[] } | { ok: false }>; resync?: () => void }) {
  const applied: string[] = [];
  const requests: number[] = [];
  const repair = new SessionGapRepair({
    apply: (event) => applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)),
    request: options?.request ?? ((sinceSeq) => {
      requests.push(sinceSeq);
      return Promise.resolve({ ok: true, frames: [] });
    }),
    resync: options?.resync ?? vi.fn(),
  });
  return { repair, applied, requests };
}

describe("SessionGapRepair", () => {
  it("applies frames straight through while idle", () => {
    const { repair, applied } = drive();
    repair.onLiveFrame(frame("a", 1), 1);
    expect(applied).toEqual(["a@1"]);
    expect(repair.holding).toBe(false);
  });

  it("holds live frames after a gap and applies the replay in front of them", async () => {
    const { repair, applied } = drive({
      request: () => Promise.resolve({ ok: true, frames: [frame("two", 2), frame("three", 3)] }),
    });
    repair.onLiveFrame(frame("before", 1), 1);
    // Frame 4 reveals the gap; it must be held, not applied.
    const settled = repair.onGap(1);
    repair.onLiveFrame(frame("revealing", 4), 4);
    repair.onLiveFrame(frame("after", 5), 5);
    expect(applied).toEqual(["before@1"]);

    await settled;
    expect(applied).toEqual(["before@1", "two@2", "three@3", "revealing@4", "after@5"]);
    expect(repair.holding).toBe(false);
  });

  it("requests exactly one replay for concurrent gaps and skips held-range dupes", async () => {
    const applied: string[] = [];
    let requests = 0;
    const repair = new SessionGapRepair({
      apply: (event) => applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)),
      request: () => {
        requests += 1;
        return Promise.resolve({ ok: true, frames: [frame("two", 2), frame("revealing", 4), frame("after", 5)] });
      },
      resync: vi.fn(),
    });
    repair.onLiveFrame(frame("before", 1), 1);
    const settled = repair.onGap(1);
    repair.onLiveFrame(frame("revealing", 4), 4);
    void repair.onGap(1); // A second sighting joins the running repair.
    repair.onLiveFrame(frame("after", 5), 5);

    await settled;
    expect(requests).toBe(1);
    // The replay's copy of 4 and 5 is skipped: the held live frames are the
    // same frames - structural dedup, no bookkeeping.
    expect(applied).toEqual(["before@1", "two@2", "revealing@4", "after@5"]);
  });

  it("answers one replay; the ring's current is the end, so no follow-up", async () => {
    const applied: string[] = [];
    const requests: number[] = [];
    const repair = new SessionGapRepair({
      apply: (event) => applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)),
      request: (sinceSeq) => {
        requests.push(sinceSeq);
        // The ring's answer covers the gap AND the dead-socket tail: frames
        // beyond its current do not exist yet, they arrive live.
        return Promise.resolve({ ok: true, frames: [frame("two", 2), frame("tail", 9)] });
      },
      resync: vi.fn(),
    });
    repair.onLiveFrame(frame("before", 1), 1);
    const settled = repair.onGap(1);
    repair.onLiveFrame(frame("revealing", 4), 4);

    await settled;
    expect(requests).toEqual([1]);
    // The transcript's timestamp placement puts the late-applying held frame
    // back in its right position; the apply sequence here is the machine's.
    expect(applied).toEqual(["before@1", "two@2", "tail@9", "revealing@4"]);
  });

  it("falls back to one resync on the resync verdict, applying held frames first", async () => {
    const applied: string[] = [];
    const resync = vi.fn();
    const repair = new SessionGapRepair({
      apply: (event) => applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)),
      request: () => Promise.resolve({ ok: false }),
      resync,
    });
    repair.onLiveFrame(frame("before", 1), 1);
    const settled = repair.onGap(1);
    repair.onLiveFrame(frame("revealing", 4), 4);

    await settled;
    expect(applied).toEqual(["before@1", "revealing@4"]);
    expect(resync).toHaveBeenCalledTimes(1);
    expect(repair.holding).toBe(false);
  });

  it("falls back to one resync when the request throws", async () => {
    const resync = vi.fn();
    const repair = new SessionGapRepair({
      apply: () => undefined,
      request: () => Promise.reject(new Error("network gone")),
      resync,
    });
    await repair.onGap(1);
    expect(resync).toHaveBeenCalledTimes(1);
  });
});
