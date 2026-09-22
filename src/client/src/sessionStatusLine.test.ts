import { describe, expect, it } from "vitest";
import { sessionStatusLine } from "./sessionStatusLine";

describe("the status bar's line", () => {
  it("shows numbers when there are numbers", () => {
    expect(sessionStatusLine({ hasStatus: true })).toEqual({ kind: "numbers" });
  });

  it("separates 'not read yet' from 'could not be read'", () => {
    expect(sessionStatusLine({ hasStatus: false })).toMatchObject({ kind: "unread" });
    expect(sessionStatusLine({ hasStatus: false, failure: "" })).toMatchObject({ kind: "unread" });
    expect(sessionStatusLine({ hasStatus: false, failure: "Session not found" })).toMatchObject({ kind: "unavailable", retry: true });
  });

  it("never leaves a failed read without a way to ask again", () => {
    const line = sessionStatusLine({ hasStatus: false, failure: "boom" });
    expect(line.kind === "unavailable" && line.retry).toBe(true);
  });
});
