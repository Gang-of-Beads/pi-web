import { describe, expect, it } from "vitest";
import { cwdUnderAny, sessionRowKind, shownArchived } from "./sessionOrder";

describe("cwdUnderAny", () => {
  const roots = ["/work/pai", "/work/peasy-collect/"];

  it("holds for the folder itself and for anything inside it", () => {
    expect(cwdUnderAny("/work/pai", roots)).toBe(true);
    expect(cwdUnderAny("/work/pai/sub", roots)).toBe(true);
    expect(cwdUnderAny("/work/peasy-collect", roots)).toBe(true);
  });

  it("does not hold for a sibling whose name starts the same", () => {
    expect(cwdUnderAny("/work/pai-archive", roots)).toBe(false);
    expect(cwdUnderAny("/work", roots)).toBe(false);
  });
});

describe("a session no listed project holds", () => {
  it("counts as archived for the lists, without being archived", () => {
    expect(sessionRowKind({ projectMissing: true })).toBe("folder-gone");
    expect(shownArchived({ projectMissing: true })).toBe(true);
  });

  it("keeps a real archive ahead of it", () => {
    expect(sessionRowKind({ projectMissing: true, archived: true })).toBe("archived");
  });
});
