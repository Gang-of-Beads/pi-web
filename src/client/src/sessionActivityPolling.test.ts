import { describe, expect, it } from "vitest";
import { oneReadAtATime, shouldPollSessionActivity } from "./sessionActivityPolling";

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
