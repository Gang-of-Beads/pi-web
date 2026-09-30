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

  it("reports since when the watched keys went without an answer, and why, for the app row", async () => {
    const { time, reads, resource } = projects();
    resource.watch("local");
    resource.watch("remote");
    void resource.refresh("local");
    expect(resource.unanswered(["local"])).toBeUndefined();
    reads.calls[0]?.reject(lost());
    await flush();
    expect(resource.unanswered(["local"])).toEqual({ since: 1_000_000, miss: { kind: "link-down" } });
    expect(resource.unanswered(["remote"])).toBeUndefined();
    time.advance(1000);
    reads.calls[1]?.reject(new HttpError("Project store is locked", 500, "local"));
    await flush();
    expect(resource.unanswered(["local"])).toEqual({ since: 1_000_000, miss: { kind: "server-error", machineId: "local", reason: "Project store is locked" } });
    void resource.refresh("remote");
    reads.calls[2]?.reject(new HttpError("Remote machine timeout", 504, "ubuntu", "gateway"));
    await flush();
    expect(resource.unanswered(["remote", "local"])).toEqual({ since: 1_000_000, miss: { kind: "server-error", machineId: "local", reason: "Project store is locked" } });
    time.advance(2000);
    reads.calls[3]?.resolve(["a"]);
    await flush();
    expect(resource.unanswered(["remote", "local"])).toEqual({ since: 1_001_000, miss: { kind: "machine-unanswering", machineId: "ubuntu" } });
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

describe("ScopedResource after a refusal or a dispose", () => {
  it("treats a lost read after a refusal as no answer, not as the old refusal", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.reject(new HttpError("Forbidden", 403));
    await flush();
    void resource.refresh("local");
    reads.calls[1]?.reject(lost());
    await flush();
    expect(resource.entry("local")).toMatchObject({ phase: "reconnecting", fact: { kind: "none" } });
  });

  it("settles a refresh asked for after dispose, and one that waited on a read in flight", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    let waited = false;
    void resource.refresh("local").then(() => { waited = true; });
    resource.dispose();
    reads.calls[0]?.resolve(["a"]);
    await flush();
    expect(waited).toBe(true);
    let late = false;
    void resource.refresh("local").then(() => { late = true; });
    await flush();
    expect(late).toBe(true);
  });
});

describe("ScopedResource.whenAnswered", () => {
  it("reads now and waits through lost answers for the one that comes, retrying while it waits", async () => {
    const { time, reads, resource } = projects();
    let view: unknown = "pending";
    void resource.whenAnswered("local", () => true).then((answer) => { view = answer; });
    reads.calls[0]?.reject(lost());
    await flush();
    expect(view).toBe("pending");
    expect(resource.entry("local").phase).toBe("reconnecting");
    time.advance(1000);
    reads.calls[1]?.resolve(["a"]);
    await flush();
    expect(view).toMatchObject({ phase: "live", known: true, data: ["a"] });
    time.advance(60_000);
    expect(reads.calls).toHaveLength(2);
  });

  it("counts a value known from an earlier read as the answer when the fresh read is lost", async () => {
    const { reads, resource } = projects();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.resolve(["a"]);
    await flush();
    const answer = resource.whenAnswered("local", () => true);
    reads.calls[1]?.reject(lost());
    await expect(answer).resolves.toMatchObject({ phase: "reconnecting", known: true, data: ["a"] });
  });

  it("answers with a refusal the server stated, which is an answer too", async () => {
    const { reads, resource } = projects();
    const answer = resource.whenAnswered("local", () => true);
    reads.calls[0]?.reject(new HttpError("Forbidden", 403));
    await expect(answer).resolves.toMatchObject({ known: false, fact: { kind: "forbidden" } });
  });

  it("stops waiting once the reader no longer wants the answer, and stops the retries it kept alive", async () => {
    const { time, reads, resource } = projects();
    let wanted = true;
    let view: unknown = "pending";
    void resource.whenAnswered("local", () => wanted).then((answer) => { view = answer; });
    reads.calls[0]?.reject(lost());
    await flush();
    wanted = false;
    time.advance(1000);
    reads.calls[1]?.reject(lost());
    await flush();
    expect(view).toBeUndefined();
    expect(time.pending()).toEqual([]);
  });

  it("does not read at all for a reader that no longer wants the answer", async () => {
    const { reads, resource } = projects();
    await expect(resource.whenAnswered("local", () => false)).resolves.toBeUndefined();
    expect(reads.calls).toHaveLength(0);
  });

  it("lets a waiter re-check at once when the selection may have moved, without waiting for a read to settle", async () => {
    const { reads, resource } = projects();
    let wanted = true;
    let view: unknown = "pending";
    void resource.whenAnswered("local", () => wanted).then((answer) => { view = answer; });
    reads.calls[0]?.reject(lost());
    await flush();
    wanted = false;
    resource.recheckWaiters();
    await flush();
    expect(view).toBeUndefined();
  });

  it("lets go of a waiter when the resource is disposed", async () => {
    const { reads, resource } = projects();
    let view: unknown = "pending";
    void resource.whenAnswered("local", () => true).then((answer) => { view = answer; });
    reads.calls[0]?.reject(lost());
    await flush();
    resource.dispose();
    await flush();
    expect(view).toBeUndefined();
  });
});

/**
 * P1 slice 5: a read built from many sources can answer for some of them. The
 * resource shows that answer and reads again on the shared backoff while the
 * key is watched, without calling it a miss - the app row stays quiet.
 */
describe("ScopedResource with an incomplete answer", () => {
  function partialReads() {
    const time = fakeClock();
    const reads = scriptedReads<{ rows: string[]; complete: boolean }>();
    const resource = new ScopedResource<string, { rows: string[]; complete: boolean }>({ keyId: (key) => key, read: reads.read, retryCapMs: 15_000, clock: time.clock, complete: (value) => value.complete });
    return { time, reads, resource };
  }

  it("shows the rows it has, reads again by itself, and becomes complete", async () => {
    const { time, reads, resource } = partialReads();
    resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.resolve({ rows: ["a"], complete: false });
    await flush();
    expect(resource.entry("local")).toMatchObject({ known: true, data: { rows: ["a"], complete: false } });
    expect(resource.unanswered(["local"])).toBeUndefined();
    expect(time.pending()).toEqual([1000]);
    time.advance(1000);
    reads.calls[1]?.resolve({ rows: ["a"], complete: false });
    await flush();
    expect(time.pending()).toEqual([2000]);
    time.advance(2000);
    reads.calls[2]?.resolve({ rows: ["a", "b"], complete: true });
    await flush();
    expect(resource.entry("local")).toMatchObject({ phase: "live", data: { rows: ["a", "b"], complete: true } });
    expect(time.pending()).toEqual([]);
  });

  it("stops reading an incomplete key nobody watches", async () => {
    const { time, reads, resource } = partialReads();
    const release = resource.watch("local");
    void resource.refresh("local");
    reads.calls[0]?.resolve({ rows: ["a"], complete: false });
    await flush();
    release();
    expect(time.pending()).toEqual([]);
  });
});
