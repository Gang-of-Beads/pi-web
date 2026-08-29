import { describe, expect, it, vi } from "vitest";
import { oneReadAtATime, READ_SETTLE_TIMEOUT_MS, shouldPollSessionActivity } from "./sessionActivityPolling";

/** A read the test finishes by hand, so overlap is arranged rather than raced. */
function heldRead() {
  const finishers: (() => void)[] = [];
  let started = 0;
  const read = async (): Promise<void> => {
    started += 1;
    await new Promise<void>((resolve) => finishers.push(resolve));
  };
  return {
    read,
    get started() { return started; },
    finishOne() { finishers.shift()?.(); },
  };
}

/** Let anything already resolved run before asserting on what it did. */
async function settle(): Promise<void> {
  for (let tick = 0; tick < 4; tick += 1) await Promise.resolve();
}

describe("shouldPollSessionActivity", () => {
  // The regression this guards: a subagent started inside the session already
  // on screen never appeared, because activity was only fetched on select.
  it("polls while a session is on screen", () => {
    expect(shouldPollSessionActivity({ hasSelectedSession: true, documentVisible: true })).toBe(true);
  });

  it("stops with the tab and with the session", () => {
    expect(shouldPollSessionActivity({ hasSelectedSession: true, documentVisible: false })).toBe(false);
    expect(shouldPollSessionActivity({ hasSelectedSession: false, documentVisible: true })).toBe(false);
  });
});

describe("oneReadAtATime", () => {
  /**
   * The timer does not wait for the read it started last time. A read slower
   * than the interval therefore had a second read started on top of it, and a
   * third on top of that, each one making the machine slower to answer the
   * next - the list falls further behind the longer it is watched.
   */
  it("does not start a second read on top of one that is still going", async () => {
    const held = heldRead();
    const refresh = oneReadAtATime(held.read);

    void refresh();
    void refresh();
    void refresh();
    await settle();

    expect(held.started).toBe(1);
  });

  /**
   * Selecting a session asks for a read at once, and it is about a different
   * session than the one in flight. Dropping it would leave the reader looking
   * at the previous session's work until the next tick.
   */
  it("honours a request that arrived while it was reading, once", async () => {
    const held = heldRead();
    const refresh = oneReadAtATime(held.read);

    const first = refresh();
    await settle();
    void refresh();
    void refresh();
    held.finishOne();
    await settle();

    // Two calls waited on one read; they collapse into a single re-read.
    expect(held.started).toBe(2);

    held.finishOne();
    await first;
    await settle();
    expect(held.started).toBe(2);
  });

  it("reads again after it has finished", async () => {
    const held = heldRead();
    const refresh = oneReadAtATime(held.read);

    const first = refresh();
    held.finishOne();
    await first;
    const second = refresh();
    held.finishOne();
    await second;

    expect(held.started).toBe(2);
  });

  it("keeps reading after a read fails", async () => {
    let started = 0;
    const refresh = oneReadAtATime(async () => {
      started += 1;
      await Promise.resolve();
      throw new Error("the machine is unreachable");
    });

    await expect(refresh()).rejects.toThrow("unreachable");
    await expect(refresh()).rejects.toThrow("unreachable");

    expect(started).toBe(2);
  });
});

describe("a read that never answers", () => {
  /**
   * A hung request held the single-read lock forever, so every later tick
   * found the lock busy and did nothing: the strip and the dock froze until a
   * manual reload. Measured against a daemon restarting mid-request.
   */
  it("releases the lock when a read outlives any honest answer", async () => {
    vi.useFakeTimers();
    try {
      let calls = 0;
      const polled = oneReadAtATime(() => {
        calls += 1;
        // 第一次读永远不回来;之后的读照常应答。
        return calls === 1 ? new Promise<void>(() => { /* 这一次读被网络吞掉,永不落定 */ }) : Promise.resolve();
      });

      void polled(); // 挂死的第一次
      await vi.advanceTimersByTimeAsync(0);
      void polled(); // 挂死期间到来的 tick,只记账
      await vi.advanceTimersByTimeAsync(READ_SETTLE_TIMEOUT_MS + 1_000);

      void polled(); // 锁应已放开,这次读要真正执行
      await vi.advanceTimersByTimeAsync(0);
      expect(calls).toBeGreaterThan(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
