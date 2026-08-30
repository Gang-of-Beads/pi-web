import { describe, expect, it, vi } from "vitest";
import { RevisionScope, revisionVerdict } from "./revisionScope";

describe("revisionVerdict", () => {
  // The notification inbox has enforced this contract since its revision was
  // added; every other sequenced surface must now answer with the same verdicts,
  // so the contract lives in one place instead of being re-derived per surface.
  it("applies exactly the next revision", () => {
    expect(revisionVerdict({ revision: 5, fresh: true }, { revision: 6 })).toBe("apply");
  });

  it("ignores a frame that predates or repeats the applied state", () => {
    expect(revisionVerdict({ revision: 5, fresh: true }, { revision: 4 })).toBe("ignore");
    expect(revisionVerdict({ revision: 5, fresh: true }, { revision: 5 })).toBe("ignore");
  });

  it("resyncs on a skipped revision", () => {
    expect(revisionVerdict({ revision: 5, fresh: true }, { revision: 7 })).toBe("resync");
  });

  it("resyncs when the surface has not been read yet", () => {
    expect(revisionVerdict({ revision: 0, fresh: false }, { revision: 1 })).toBe("resync");
  });

  it("resyncs when the server declares the delta unappliable", () => {
    expect(revisionVerdict({ revision: 5, fresh: true }, { revision: 6, resync: true })).toBe("resync");
  });

  it("ignores a revision the surface has already passed even on an unread surface", () => {
    // Matching the inbox: a frame at or below the last known revision carries
    // nothing new whether or not the surface has been fully read.
    expect(revisionVerdict({ revision: 3, fresh: false }, { revision: 3 })).toBe("ignore");
  });
});

describe("RevisionScope", () => {
  it("advances only through applied revisions and full reads", () => {
    const scope = new RevisionScope({ resync: () => undefined });
    scope.markFresh(5);
    expect(scope.observe({ revision: 6 }, () => "applied")).toBe("applied");
    expect(scope.revision).toBe(6);
    expect(scope.observe({ revision: 9 }, () => "applied")).toBeUndefined();
    // A gap must not advance the scope: the applied state is still 6 until a
    // full read says otherwise.
    expect(scope.revision).toBe(6);
  });

  it("fails open on an unstamped frame without moving the revision", () => {
    const scope = new RevisionScope({ resync: () => undefined });
    scope.markFresh(5);
    // A peer that has not been upgraded sends frames without a revision; the
    // design fails these open exactly as the unsequenced behaviour, and the
    // scope must not treat the absence as revision zero.
    expect(scope.observe({}, () => "applied")).toBe("applied");
    expect(scope.revision).toBe(5);
  });

  /**
   * A revision only orders frames within one daemon instance. A restarted
   * daemon counts from 1 again; without noticing the identity change, the
   * scope's high-water mark from the old instance silently ignores every new
   * frame until the session is reselected - the surface looks alive and is
   * deaf. An instance change resets the space and repairs once.
   */
  it("resets the revision space when the daemon instance changes", async () => {
    const resync = vi.fn((): Promise<void> => Promise.resolve());
    const scope = new RevisionScope({ resync });
    scope.markFresh(5, "daemon-a");
    expect(scope.observe({ revision: 6, daemonInstanceId: "daemon-a" }, () => "applied")).toBe("applied");

    // Restarted daemon: counter starts over. The frame must not be ignored.
    expect(scope.observe({ revision: 1, daemonInstanceId: "daemon-b" }, () => "applied")).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(resync).toHaveBeenCalledTimes(1);

    // The repair read reports the new instance; its frames then flow strictly.
    scope.markFresh(1, "daemon-b");
    expect(scope.observe({ revision: 2, daemonInstanceId: "daemon-b" }, () => "applied")).toBe("applied");
    // And the old instance's stragglers no longer order against the new space.
    expect(scope.observe({ revision: 7, daemonInstanceId: "daemon-a" }, () => "applied")).toBeUndefined();
  });

  it("keeps ordering within one instance when frames carry no identity", () => {
    const scope = new RevisionScope({ resync: () => undefined });
    scope.markFresh(5, "daemon-a");
    // Unstamped identity keeps the current space - old daemons and stream
    // vocabulary continue exactly as before.
    expect(scope.observe({ revision: 6 }, () => "applied")).toBe("applied");
  });

  it("fires the resync callback exactly once for a skipped revision", async () => {
    const resync = vi.fn((): Promise<void> => Promise.resolve());
    const scope = new RevisionScope({ resync });
    scope.markFresh(5);
    expect(scope.observe({ revision: 8 }, () => "applied")).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    expect(resync).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent resyncs into one callback", async () => {
    let release: (() => void) | undefined;
    const resync = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const scope = new RevisionScope({ resync });
    scope.markFresh(5);
    scope.observe({ revision: 7 }, () => "applied");
    scope.observe({ revision: 8 }, () => "applied");
    scope.observe({ revision: 9 }, () => "applied");
    await Promise.resolve();
    expect(resync).toHaveBeenCalledTimes(1);
    release?.();
  });

  it("does not fire a second resync while one is in flight", async () => {
    let release: (() => void) | undefined;
    const resync = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const scope = new RevisionScope({ resync });
    scope.markFresh(5);
    scope.observe({ revision: 7 }, () => "applied");
    await Promise.resolve();
    scope.observe({ revision: 9 }, () => "applied");
    expect(resync).toHaveBeenCalledTimes(1);
    release?.();
    await Promise.resolve();
    // After the in-flight resync settles, a later gap schedules a fresh one.
    scope.observe({ revision: 12 }, () => "applied");
    await Promise.resolve();
    expect(resync).toHaveBeenCalledTimes(2);
  });

  it("stops applying after a failed read until the surface is fresh again", () => {
    const scope = new RevisionScope({ resync: () => undefined });
    scope.markFresh(5);
    scope.markUnfresh();
    expect(scope.observe({ revision: 6 }, () => "applied")).toBeUndefined();
  });
});
