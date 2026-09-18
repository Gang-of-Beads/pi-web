import { describe, expect, it } from "vitest";
import { noticeLabel, taskNotice } from "./taskNotice";

describe("taskNotice", () => {
  it("reads the daemon's own task record", () => {
    expect(taskNotice({ id: "t1", name: "watch publish run", status: "completed", exitCode: 0 }))
      .toEqual({ name: "watch publish run", outcome: "completed", detail: "exit 0" });
  });

  it("names a failure with its exit code", () => {
    expect(noticeLabel(taskNotice({ name: "build", status: "failed", exitCode: 2 }))).toBe("build failed · exit 2");
  });

  it("says a run is still going rather than inventing an end", () => {
    expect(noticeLabel(taskNotice({ name: "dev server", status: "running" }))).toBe("dev server still running");
  });

  it("does not claim an outcome it was not given", () => {
    expect(noticeLabel(taskNotice({ name: "mystery" }))).toBe("mystery reported · no status reported");
    expect(noticeLabel(taskNotice(undefined))).toBe("Background task reported · no status reported");
  });
});
