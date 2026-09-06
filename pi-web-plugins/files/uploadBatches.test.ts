import { describe, expect, it } from "vitest";
import {
  cancelWorkspaceUploadBatch,
  completeWorkspaceUploadBatch,
  createWorkspaceUploadBatchState,
  failWorkspaceUploadBatch,
  updateWorkspaceUploadBatchProgress,
} from "./uploadBatches";
import { workspaceUploadPath } from "./uploadPaths";

function batch() {
  return createWorkspaceUploadBatchState({
    id: "batch-1",
    workspaceId: "w1",
    destinationFolder: "docs",
    files: [{ name: "a.txt", size: 100 }, { name: "b.txt", size: 300 }],
    startedAt: "2026-09-06T00:00:00.000Z",
  });
}

describe("workspace upload batch state", () => {
  it("builds destination paths under the folder with the first file uploading", () => {
    const state = batch();
    expect(state.status).toBe("uploading");
    expect(state.currentFileIndex).toBe(0);
    expect(state.files[0]?.path).toBe("docs/a.txt");
    expect(state.files[0]?.status).toBe("uploading");
    expect(state.files[1]?.status).toBe("pending");
    expect(state.total).toBe(400);
  });

  it("progress marks the current file uploading and finished files completed", () => {
    const updated = updateWorkspaceUploadBatchProgress(batch(), {
      currentFileIndex: 1,
      files: [
        { index: 0, name: "a.txt", path: "docs/a.txt", loaded: 100, total: 100, percent: 1, lengthComputable: true, done: true },
        { index: 1, name: "b.txt", path: "docs/b.txt", loaded: 120, total: 300, percent: 0.4, lengthComputable: true, done: false },
      ],
      loaded: 220,
      total: 400,
      percent: 0.55,
      done: false,
    });
    expect(updated.files[0]?.status).toBe("completed");
    expect(updated.files[1]?.status).toBe("uploading");
    expect(updated.percent).toBe(0.55);
  });

  it("progress records per-file errors without failing the batch early", () => {
    const updated = updateWorkspaceUploadBatchProgress(batch(), {
      currentFileIndex: 0,
      files: [
        { index: 0, name: "a.txt", path: "docs/a.txt", loaded: 100, total: 100, percent: 1, lengthComputable: true, done: true, error: "File exists" },
        { index: 1, name: "b.txt", path: "docs/b.txt", loaded: 0, total: 300, percent: 0, lengthComputable: true, done: false },
      ],
      loaded: 100,
      total: 400,
      percent: 0.25,
      done: false,
    });
    expect(updated.files[0]?.status).toBe("error");
    expect(updated.files[0]?.error).toBe("File exists");
    expect(updated.status).toBe("uploading");
  });

  it("completion fills every file and freezes progress", () => {
    const completed = completeWorkspaceUploadBatch(batch(), [{ path: "docs/a.txt", size: 100, modifiedAt: "2026-09-06T00:00:01.000Z", created: true }, { path: "docs/b.txt", size: 300, modifiedAt: "2026-09-06T00:00:02.000Z", created: true }], "2026-09-06T00:00:03.000Z");
    expect(completed.status).toBe("completed");
    expect(completed.files.every((file) => file.status === "completed")).toBe(true);
    expect(completed.files[1]?.response?.path).toBe("docs/b.txt");
    expect(completed.percent).toBe(1);
  });

  it("failure fails the uploading file and cancels the pending ones", () => {
    const failed = failWorkspaceUploadBatch(batch(), "Disk full", "2026-09-06T00:00:03.000Z");
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("Disk full");
    expect(failed.files[0]?.status).toBe("error");
    expect(failed.files[1]?.status).toBe("cancelled");
    expect(failed.files[1]?.error).toBe("Not uploaded because an earlier file failed.");
  });

  it("cancellation keeps completed files and cancels the rest", () => {
    const progressed = updateWorkspaceUploadBatchProgress(batch(), {
      currentFileIndex: 1,
      files: [
        { index: 0, name: "a.txt", path: "docs/a.txt", loaded: 100, total: 100, percent: 1, lengthComputable: true, done: true },
        { index: 1, name: "b.txt", path: "docs/b.txt", loaded: 50, total: 300, percent: 0.2, lengthComputable: true, done: false },
      ],
      loaded: 150,
      total: 400,
      percent: 0.375,
      done: false,
    });
    const cancelled = cancelWorkspaceUploadBatch(progressed, "2026-09-06T00:00:03.000Z");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.files[0]?.status).toBe("completed");
    expect(cancelled.files[1]?.status).toBe("cancelled");
  });

  it("workspace upload paths stay workspace-relative and reject traversal", () => {
    expect(workspaceUploadPath(" docs\\manual// ", "./report.txt")).toBe("docs/manual/report.txt");
    expect(workspaceUploadPath("", "report.txt")).toBe("report.txt");
    expect(() => workspaceUploadPath("/tmp", "report.txt")).toThrow("workspace-relative");
    expect(() => workspaceUploadPath("docs", "../secret.txt")).toThrow("path traversal");
    expect(() => workspaceUploadPath("docs", " ")).toThrow("must not be empty");
  });
});
