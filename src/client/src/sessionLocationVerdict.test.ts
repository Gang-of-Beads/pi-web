import { describe, expect, it } from "vitest";
import { sessionLocationVerdict } from "./sessionLocationVerdict";

describe("sessionLocationVerdict", () => {
  it("calls the workspace's own directory described", () => {
    expect(sessionLocationVerdict("/home/user/repo", "/home/user/repo")).toBe("described");
  });

  it("calls a subdirectory session described", () => {
    expect(sessionLocationVerdict("/home/user/repo/nested", "/home/user/repo")).toBe("described");
  });

  it("does not mistake a sibling with a shared name prefix for containment", () => {
    expect(sessionLocationVerdict("/home/user/repo-two", "/home/user/repo")).toBe("unknown");
  });

  it("calls a directory outside the workspace unknown", () => {
    expect(sessionLocationVerdict("/elsewhere", "/home/user/repo")).toBe("unknown");
  });

  it("treats a missing workspace as unknown", () => {
    expect(sessionLocationVerdict("/home/user/repo", undefined)).toBe("unknown");
    expect(sessionLocationVerdict("/home/user/repo", "")).toBe("unknown");
  });

  it("treats a session without a directory as unknown", () => {
    expect(sessionLocationVerdict("", "/home/user/repo")).toBe("unknown");
  });

  it("handles a workspace path that already ends with a separator", () => {
    expect(sessionLocationVerdict("/home/user/repo/nested", "/home/user/repo/")).toBe("described");
  });
});
