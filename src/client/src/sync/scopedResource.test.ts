import { describe, expect, it } from "vitest";
import { HttpError } from "../api/http";
import { ScopedResource, type ResourceClock } from "./scopedResource";

interface Timer { at: number; callback: () => void; cancelled: boolean }

function fakeClock() {
  let now = 1_000_000;
  const timers: Timer[] = [];
  const clock: ResourceClock = {
    now: () => now,
    setTimer: (callback, delayMs) => {
      const timer = { at: now + delayMs, callback, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
  };
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers.filter((candidate) => !candidate.cancelled && candidate.at <= now)) {
      timer.cancelled = true;
      timer.callback();
    }
  };
  const pending = () => timers.filter((timer) => !timer.cancelled).map((timer) => timer.at - now);
  return { clock, advance, pending };
}

/** Reads the test answers by hand, in order. */
function scriptedReads<V>() {
  const calls: { key: string; resolve: (value: V) => void; reject: (error: unknown) => void }[] = [];
  const read = (key: string) => new Promise<V>((resolve, reject) => { calls.push({ key, resolve, reject }); });
  return { calls, read };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const lost = () => new TypeError("Failed to fetch");

function projects() {
  const time = fakeClock();
  const reads = scriptedReads<string[]>();
  const resource = new ScopedResource<string, string[]>({ keyId: (key) => key, read: reads.read, retryCapMs: 15_000, clock: time.clock });
  return { time, reads, resource };
}

describe("ScopedResource", () => {
  it("shows a value only once it is read, and only under its own key", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    const settled = resource.refresh("local");
    expect(resource.entry("local")).toMatchObject({ phase: "syncing", known: false });
    reads.calls[0]?.resolve(["a"]);
    await settled;
    expect(resource.entry("local")).toMatchObject({ phase: "live", known: true, data: ["a"] });
    expect(resource.entry("remote")).toMatchObject({ phase: "syncing", known: false, data: undefined });
  });

  it("never gives up on a read that got no answer: it retries 1, 2, 4 s later without input and becomes live", async () => {
    const { time, reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.reject(lost());
    await flush();
    expect(resource.entry("local")).toMatchObject({ phase: "reconnecting", known: false, firstMissAt: 1_000_000 });
    expect(time.pending()).toEqual([1000]);
    time.advance(1000);
    reads.calls[1]?.reject(lost());
    await flush();
    expect(time.pending()).toEqual([2000]);
    time.advance(2000);
    expect(resource.entry("local")).toMatchObject({ phase: "reconnecting", firstMissAt: 1_000_000 });
    reads.calls[2]?.resolve(["a"]);
    await flush();
    expect(resource.entry("local")).toMatchObject({ phase: "live", known: true, data: ["a"], firstMissAt: undefined });
    expect(reads.calls).toHaveLength(3);
    expect(time.pending()).toEqual([]);
  });

  it("keeps the known value while it reconnects, so a lost answer never blanks the list", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.resolve(["a"]);
    await flush();
    void resource.refresh("local");
    reads.calls[1]?.reject(lost());
    await flush();
    expect(resource.entry("local")).toMatchObject({ phase: "reconnecting", known: true, data: ["a"] });
  });

  it("stops at a refusal the server stated, and does not retry it", async () => {
    const { time, reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.reject(new HttpError("Unauthorized", 401));
    await flush();
    expect(resource.entry("local")).toMatchObject({ fact: { kind: "signed-out" }, firstMissAt: undefined });
    expect(time.pending()).toEqual([]);
  });

  it("reads once more when asked during a read in flight, and answers that ask with the newer read", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    let secondSettled = false;
    void resource.refresh("local").then(() => { secondSettled = true; });
    expect(reads.calls).toHaveLength(1);
    reads.calls[0]?.resolve(["old"]);
    await flush();
    expect(secondSettled).toBe(false);
    expect(reads.calls).toHaveLength(2);
    reads.calls[1]?.resolve(["new"]);
    await flush();
    expect(secondSettled).toBe(true);
    expect(resource.entry("local").data).toEqual(["new"]);
  });

  it("retries only while someone watches, and resumes when watched again", async () => {
    const { time, reads, resource } = projects();
    const unwatch = resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.reject(lost());
    await flush();
    unwatch();
    expect(time.pending()).toEqual([]);
    time.advance(60_000);
    expect(reads.calls).toHaveLength(1);
    resource.watch("local");
    expect(reads.calls).toHaveLength(2);
  });

  it("retries at once on a sign of life instead of waiting out the backoff", async () => {
    const { time, reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.reject(lost());
    await flush();
    resource.wake();
    expect(reads.calls).toHaveLength(2);
    expect(time.pending()).toEqual([]);
  });

  it("reports since when the watched keys went without an answer, for the app row", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    expect(resource.unansweredSince(["local"])).toBeUndefined();
    reads.calls[0]?.reject(lost());
    await flush();
    expect(resource.unansweredSince(["local"])).toBe(1_000_000);
    expect(resource.unansweredSince(["remote"])).toBeUndefined();
  });

  it("applies this client's own writes to a known value and leaves an unknown key unknown", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.resolve(["a"]);
    await flush();
    resource.update("local", (list) => [...list, "b"]);
    resource.update("remote", (list) => [...list, "b"]);
    expect(resource.entry("local").data).toEqual(["a", "b"]);
    expect(resource.entry("remote").known).toBe(false);
  });
});
