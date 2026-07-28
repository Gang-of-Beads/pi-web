import { describe, expect, it, vi } from "vitest";
import { countOutOfListingChildren, locateOutOfListingParents } from "./parentSessionLocator.js";
import type { SessionHeaderSummary } from "./sessionFileHeader.js";

const PARENT_PATH = "/sessions/--srv-other--/parent.jsonl";
const LISTING_CWD = "/srv/dev/pi-web";
const PARENT_CWD = "/srv/other-worktree";

describe("locateOutOfListingParents", () => {
  it("reports the cwd and id of a parent that is not in the listing", async () => {
    const readHeader = headerReader({ [PARENT_PATH]: { id: "parent-id", cwd: PARENT_CWD } });

    const located = await locateOutOfListingParents([child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(located.get(PARENT_PATH)).toEqual({ parentSessionId: "parent-id", parentSessionCwd: PARENT_CWD });
  });

  it("does not read headers for parents already present in the listing", async () => {
    const readHeader = headerReader({});

    const located = await locateOutOfListingParents([{ path: PARENT_PATH }, child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(located.size).toBe(0);
    expect(readHeader).not.toHaveBeenCalled();
  });

  it("reads each distinct missing parent once even when several children share it", async () => {
    const readHeader = headerReader({ [PARENT_PATH]: { id: "parent-id", cwd: PARENT_CWD } });

    await locateOutOfListingParents([child(PARENT_PATH), child(PARENT_PATH), child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(readHeader).toHaveBeenCalledTimes(1);
  });

  it("omits parents whose header cannot be read, so callers keep the generic unavailable state", async () => {
    const readHeader = headerReader({});

    const located = await locateOutOfListingParents([child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(located.size).toBe(0);
  });

  it("omits parents whose header carries no cwd, as in very old session files", async () => {
    const readHeader = headerReader({ [PARENT_PATH]: { id: "parent-id" } });

    const located = await locateOutOfListingParents([child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(located.size).toBe(0);
  });

  it("ignores sessions without a recorded parent", async () => {
    const readHeader = headerReader({});

    const located = await locateOutOfListingParents([{ path: "/sessions/root.jsonl" }], LISTING_CWD, readHeader);

    expect(located.size).toBe(0);
    expect(readHeader).not.toHaveBeenCalled();
  });
});

describe("locateOutOfListingParents cwd comparison", () => {
  it("omits a parent that resolves to the listing's own cwd, which needs no jump target", async () => {
    const readHeader = headerReader({ [PARENT_PATH]: { id: "parent-id", cwd: LISTING_CWD } });

    const located = await locateOutOfListingParents([child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(located.size).toBe(0);
  });

  it("treats a cwd differing only by a trailing separator as the same workspace", async () => {
    const readHeader = headerReader({ [PARENT_PATH]: { id: "parent-id", cwd: `${LISTING_CWD}/` } });

    const located = await locateOutOfListingParents([child(PARENT_PATH)], LISTING_CWD, readHeader);

    expect(located.size).toBe(0);
  });
});

describe("countOutOfListingChildren", () => {
  it("counts children in other workspaces per listed parent session", () => {
    const parentA = { path: "/sessions/--srv-dev--/parent-a.jsonl" };
    const parentB = { path: "/sessions/--srv-dev--/parent-b.jsonl" };

    const counts = countOutOfListingChildren([parentA, parentB], [parentA.path, parentA.path, parentB.path]);

    expect(counts.get(parentA.path)).toBe(2);
    expect(counts.get(parentB.path)).toBe(1);
  });

  it("ignores children pointing at sessions that are not in the listing", () => {
    const counts = countOutOfListingChildren(
      [{ path: "/sessions/--srv-dev--/listed.jsonl" }],
      ["/sessions/--srv-other--/unlisted.jsonl"],
    );

    expect(counts.size).toBe(0);
  });

  it("matches parent paths that differ only by normalization", () => {
    const counts = countOutOfListingChildren(
      [{ path: "/sessions/--srv-dev--/parent.jsonl" }],
      ["/sessions/--srv-dev--/./parent.jsonl"],
    );

    expect(counts.get("/sessions/--srv-dev--/parent.jsonl")).toBe(1);
  });

  it("reports nothing when no sessions elsewhere claim a parent", () => {
    expect(countOutOfListingChildren([{ path: "/sessions/a.jsonl" }], []).size).toBe(0);
  });
});

function child(parentSessionPath: string) {
  return { path: `/sessions/--srv-dev--/child-${Math.random().toString(36).slice(2)}.jsonl`, parentSessionPath };
}

function headerReader(headers: Record<string, SessionHeaderSummary>) {
  return vi.fn((sessionFile: string) => Promise.resolve(headers[sessionFile]));
}
