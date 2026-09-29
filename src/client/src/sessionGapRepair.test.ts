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
    // Replayed and held frames apply merged by seq, one copy each.
    expect(applied).toEqual(["before@1", "two@2", "revealing@4", "tail@9"]);
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

describe("SessionGapRepair seeded from a snapshot", () => {
  function seeded(frames: SessionUiEvent[] = []) {
    const applied: string[] = [];
    const requests: { sinceSeq: number; epoch: string | undefined }[] = [];
    const repair = new SessionGapRepair({
      apply: (event) => { applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)); },
      request: (sinceSeq, epoch) => {
        requests.push({ sinceSeq, epoch });
        return Promise.resolve({ ok: true, frames });
      },
      resync: vi.fn(),
    });
    repair.seed({ seq: 5, epoch: "daemon-a.1" });
    return { repair, applied, requests };
  }
  const settle = async (): Promise<void> => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); };
  const inEpoch = (text: string, seq: number, epoch: string): SessionUiEvent => ({ type: "assistant.delta", text, seq, epoch });

  it("drops frames the snapshot already reflects, and applies the next one", () => {
    const { repair, applied, requests } = seeded();
    repair.onLiveFrame(inEpoch("reflected", 5, "daemon-a.1"), 5);
    repair.onLiveFrame(inEpoch("next", 6, "daemon-a.1"), 6);
    expect({ applied, requests }).toEqual({ applied: ["next@6"], requests: [] });
  });

  it("sees a jump past the snapshot itself and fetches the missed range in the snapshot's epoch", async () => {
    const { repair, applied, requests } = seeded([inEpoch("missed", 6, "daemon-a.1")]);
    repair.onLiveFrame(inEpoch("revealing", 7, "daemon-a.1"), 7);
    await settle();
    expect({ applied, requests }).toEqual({ applied: ["missed@6", "revealing@7"], requests: [{ sinceSeq: 5, epoch: "daemon-a.1" }] });
  });

  it("starts over in a new epoch: its seqs are not the old space's, and its gaps are fetched in it", async () => {
    const { repair, applied, requests } = seeded([inEpoch("new two", 2, "daemon-b.1")]);
    repair.onLiveFrame(inEpoch("old six", 6, "daemon-a.1"), 6);
    repair.onLiveFrame(inEpoch("new one", 1, "daemon-b.1"), 1);
    repair.onLiveFrame(inEpoch("new three", 3, "daemon-b.1"), 3);
    await settle();
    expect({ applied, requests }).toEqual({
      applied: ["old six@6", "new one@1", "new two@2", "new three@3"],
      requests: [{ sinceSeq: 1, epoch: "daemon-b.1" }],
    });
  });
});

describe("SessionGapRepair entering a new space on a live frame", () => {
  it("applies the frame and asks for a full read once: what the new space published before it is unknown", () => {
    const resync = vi.fn();
    const applied: string[] = [];
    const repair = new SessionGapRepair({ apply: (event) => { applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)); }, request: () => Promise.resolve({ ok: true, frames: [] }), resync });
    repair.seed({ seq: 40, epoch: "daemon-a.1" });

    repair.onLiveFrame({ type: "assistant.delta", text: "after restart", seq: 7, epoch: "daemon-b.1" }, 7);
    repair.onLiveFrame({ type: "assistant.delta", text: "next", seq: 8, epoch: "daemon-b.1" }, 8);

    expect({ applied, resyncs: resync.mock.calls.length }).toEqual({ applied: ["after restart@7", "next@8"], resyncs: 1 });
  });
});

describe("SessionGapRepair reseeded below its frontier", () => {
  const settle = async (): Promise<void> => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
  const inEpoch = (text: string, seq: number): SessionUiEvent => ({ type: "assistant.delta", text, seq, epoch: "daemon-a.1" });

  function reseedable(reply: (sinceSeq: number) => Promise<{ ok: true; frames: SessionUiEvent[] }>) {
    const applied: string[] = [];
    const requests: number[] = [];
    const repair = new SessionGapRepair({
      apply: (event) => { applied.push(("text" in event ? event.text : event.type) + seqSuffix(event)); },
      request: (sinceSeq) => { requests.push(sinceSeq); return reply(sinceSeq); },
      resync: vi.fn(),
    });
    repair.seed({ seq: 5, epoch: "daemon-a.1" });
    return { repair, applied, requests };
  }

  it("fetches again what it applied past the new seed, since that went onto the view the seed replaced", async () => {
    const { repair, applied, requests } = reseedable(() => Promise.resolve({ ok: true, frames: [inEpoch("seven", 7)] }));
    repair.onLiveFrame(inEpoch("six", 6), 6);
    repair.onLiveFrame(inEpoch("seven", 7), 7);
    applied.length = 0;
    repair.seed({ seq: 6, epoch: "daemon-a.1" });
    await settle();
    expect({ applied, requests }).toEqual({ applied: ["seven@7"], requests: [6] });
  });

  it("fetches nothing when the seed is at or past everything applied, or in another epoch", async () => {
    const { repair, requests } = reseedable(() => Promise.resolve({ ok: true, frames: [] }));
    repair.onLiveFrame(inEpoch("six", 6), 6);
    repair.seed({ seq: 6, epoch: "daemon-a.1" });
    repair.onLiveFrame(inEpoch("seven", 7), 7);
    repair.seed({ seq: 2, epoch: "daemon-b.1" });
    await settle();
    expect(requests).toEqual([]);
  });

  it("asks again from the new seed when it is reseeded during a repair, and applies in seq order", async () => {
    const first = deferredReply();
    const { repair, applied, requests } = reseedable((sinceSeq) => (sinceSeq === 7 ? first.promise : Promise.resolve({ ok: true, frames: [inEpoch("six", 6), inEpoch("seven", 7), inEpoch("eight", 8)] })));
    repair.onLiveFrame(inEpoch("six", 6), 6);
    repair.onLiveFrame(inEpoch("seven", 7), 7);
    repair.onLiveFrame(inEpoch("nine", 9), 9);
    applied.length = 0;
    repair.seed({ seq: 5, epoch: "daemon-a.1" });
    first.resolve({ ok: true, frames: [inEpoch("eight", 8)] });
    await settle();
    expect({ applied, requests }).toEqual({ applied: ["six@6", "seven@7", "eight@8", "nine@9"], requests: [7, 5] });
  });
});

function deferredReply() {
  let resolve: (value: { ok: true; frames: SessionUiEvent[] }) => void = () => undefined;
  const promise = new Promise<{ ok: true; frames: SessionUiEvent[] }>((settle) => { resolve = settle; });
  return { promise, resolve };
}
