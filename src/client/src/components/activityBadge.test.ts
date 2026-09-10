// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from "vitest";
import { hasStatusUnread, statusActivityKind } from "./activityBadge";

afterEach(() => {
  document.body.replaceChildren();
});

describe("statusActivityKind", () => {
  it("prefers work in progress over a live terminal", () => {
    expect(statusActivityKind({ "core:working": true, "core:terminal": true })).toBe("session");
    expect(statusActivityKind({ "core:terminal": true })).toBe("terminal");
  });

  it("treats unread as attention rather than work", () => {
    expect(statusActivityKind({ "core:unread": true })).toBeUndefined();
    expect(hasStatusUnread({ "core:unread": true })).toBe(true);
    expect(hasStatusUnread({ "core:working": true })).toBe(false);
  });

  it("falls back to the generic work mark for a flag id this build does not know", () => {
    expect(statusActivityKind({ "core:future": true })).toBe("session");
  });

  it("shows nothing for a node with no set flag and for a machine with no snapshot", () => {
    expect(statusActivityKind({ "core:working": false })).toBeUndefined();
    expect(statusActivityKind(undefined)).toBeUndefined();
    expect(hasStatusUnread(undefined)).toBe(false);
  });
});


