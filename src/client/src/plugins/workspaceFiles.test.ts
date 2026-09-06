// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import type { FileContentResponse, FileTreeResponse } from "../api";
import type { WorkspaceUploadBatchProgress } from "../../../shared/pluginApiTypes";
import { createWorkspaceFiles, type WorkspaceFilesApi } from "./workspaceFiles";

const workspace = { id: "w-1", projectId: "p-1" };

const uploadWorkspaceFilesMock = vi.hoisted(() => vi.fn());

vi.mock("../api/workspaceUploads", () => ({ DEFAULT_WORKSPACE_UPLOADS_FOLDER: ".pi-web/uploads", uploadWorkspaceFiles: uploadWorkspaceFilesMock }));

describe("createWorkspaceFiles", () => {
  it("listFiles resolves with the directory listing for the bound workspace and machine", async () => {
    const tree = testFileTreeResponse();
    const workspaceTree = vi.fn<WorkspaceFilesApi["workspaceTree"]>(() => Promise.resolve(tree));
    const files = createWorkspaceFiles(fakeApi({ workspaceTree }), workspace, "remote-1");

    await expect(files.listFiles(".pi-web/relays")).resolves.toBe(tree);
    expect(workspaceTree).toHaveBeenCalledWith("p-1", "w-1", ".pi-web/relays", "remote-1");
  });

  it("listFiles rejects when the directory is missing, matching readFile error behavior", async () => {
    const workspaceTree = vi.fn<WorkspaceFilesApi["workspaceTree"]>(() => Promise.reject(new Error("Path not found: .pi-web/relays")));
    const files = createWorkspaceFiles(fakeApi({ workspaceTree }), workspace, "local");

    await expect(files.listFiles(".pi-web/relays")).rejects.toThrow("Path not found: .pi-web/relays");
  });

  it("readFile reads through the bound workspace and machine", async () => {
    const content = testFileContent("README.md");
    const workspaceFile = vi.fn<WorkspaceFilesApi["workspaceFile"]>(() => Promise.resolve(content));
    const files = createWorkspaceFiles(fakeApi({ workspaceFile }), workspace, "remote-1");

    await expect(files.readFile("README.md")).resolves.toBe(content);
    expect(workspaceFile).toHaveBeenCalledWith("p-1", "w-1", "README.md", "remote-1");
  });

  it("writeFile reports the change after a successful write", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(() => Promise.resolve({ path: "out.txt", size: 2, modifiedAt: "2026-06-14T10:00:00.000Z", created: true }));
    const onFilesChanged = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ writeWorkspaceFile }), workspace, "local", onFilesChanged);

    const result = await files.writeFile("out.txt", "hi");
    expect(result.created).toBe(true);
    expect(writeWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "out.txt", "hi", undefined, "local");
    expect(onFilesChanged).toHaveBeenCalledOnce();
  });

  it("deleteFile and moveFile report the change after success", async () => {
    const deleteWorkspaceFile = vi.fn<WorkspaceFilesApi["deleteWorkspaceFile"]>(() => Promise.resolve({ path: "old.txt", existed: true }));
    const moveWorkspaceFile = vi.fn<WorkspaceFilesApi["moveWorkspaceFile"]>(() => Promise.resolve({ fromPath: "old.txt", toPath: "new.txt", size: 0, modifiedAt: "2026-06-14T10:00:00.000Z" }));
    const onFilesChanged = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ deleteWorkspaceFile, moveWorkspaceFile }), workspace, "local", onFilesChanged);

    await files.deleteFile("old.txt");
    await files.moveFile("old.txt", "new.txt");
    expect(deleteWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "old.txt", "local");
    expect(moveWorkspaceFile).toHaveBeenCalledWith("p-1", "w-1", "old.txt", "new.txt", undefined, "local");
    expect(onFilesChanged).toHaveBeenCalledTimes(2);
  });

  it("does not report a change when a mutation fails", async () => {
    const writeWorkspaceFile = vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(() => Promise.reject(new Error("File exists: out.txt")));
    const onFilesChanged = vi.fn();
    const files = createWorkspaceFiles(fakeApi({ writeWorkspaceFile }), workspace, "local", onFilesChanged);

    await expect(files.writeFile("out.txt", "hi", { overwrite: false })).rejects.toThrow("File exists: out.txt");
    expect(onFilesChanged).not.toHaveBeenCalled();
  });

  it("previewUrl builds the bound workspace's preview URL without a leading slash", () => {
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote-1");

    const url = files.previewUrl("docs/notes.md", { modifiedAt: "2026-06-14T10:00:00.000Z", download: true });
    expect(url).not.toMatch(/^\//);
    expect(url).toContain("api/machines/remote-1/projects/p-1/workspaces/w-1/file/preview");
    expect(url).toContain("path=docs%2Fnotes.md");
    expect(url).toContain("v=2026-06-14T10%3A00%3A00.000Z");
    expect(url).toContain("download=1");
  });

  it("uploadFiles delegates to the upload transport with the bound machine and forwards progress", async () => {
    const onProgress = vi.fn<(progress: WorkspaceUploadBatchProgress) => void>();
    const file = new File(["hi"], "note.txt", { type: "text/plain" });
    const responses = [{ path: "docs/note.txt", size: 2, modifiedAt: "2026-06-14T10:00:00.000Z", created: true }];
    uploadWorkspaceFilesMock.mockImplementation((_projectId: string, _workspaceId: string, _files: readonly File[], options: { onProgress?: (progress: WorkspaceUploadBatchProgress) => void }) => {
      options.onProgress?.({ currentFileIndex: 0, files: [{ index: 0, name: "note.txt", path: "docs/note.txt", loaded: 2, total: 2, percent: 1, lengthComputable: true, done: true }], loaded: 2, total: 2, percent: 1, done: true });
      return { promise: Promise.resolve(responses), cancel: () => undefined };
    });
    const files = createWorkspaceFiles(fakeApi(), workspace, "remote-1");

    const upload = files.uploadFiles([file], { destinationFolder: "docs", overwrite: true, onProgress });
    const written = await upload.promise;

    expect(written).toBe(responses);
    expect(uploadWorkspaceFilesMock).toHaveBeenCalledWith("p-1", "w-1", [file], expect.objectContaining({ destinationFolder: "docs", overwrite: true, machineId: "remote-1" }));
    expect(onProgress).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls[0]?.[0]?.files[0]?.path).toBe("docs/note.txt");
    expect(typeof upload.cancel).toBe("function");
  });
});

function fakeApi(overrides: Partial<WorkspaceFilesApi> = {}): WorkspaceFilesApi {
  const unexpected = (name: string) => () => Promise.reject(new Error(`Unexpected ${name} call`));
  return {
    workspaceFile: vi.fn<WorkspaceFilesApi["workspaceFile"]>(unexpected("workspaceFile")),
    workspaceTree: vi.fn<WorkspaceFilesApi["workspaceTree"]>(unexpected("workspaceTree")),
    writeWorkspaceFile: vi.fn<WorkspaceFilesApi["writeWorkspaceFile"]>(unexpected("writeWorkspaceFile")),
    deleteWorkspaceFile: vi.fn<WorkspaceFilesApi["deleteWorkspaceFile"]>(unexpected("deleteWorkspaceFile")),
    moveWorkspaceFile: vi.fn<WorkspaceFilesApi["moveWorkspaceFile"]>(unexpected("moveWorkspaceFile")),
    ...overrides,
  };
}

function testFileTreeResponse(path = ".pi-web/relays"): FileTreeResponse {
  return {
    path,
    entries: [{ name: "relays-panel-plugin", path: `${path}/relays-panel-plugin`, type: "directory", modifiedAt: "2026-06-14T10:00:00.000Z" }],
    scannedAt: "2026-06-14T10:00:01.000Z",
    truncated: false,
  };
}

function testFileContent(path: string): FileContentResponse {
  return {
    path,
    encoding: "utf8",
    size: 0,
    modifiedAt: "2026-06-14T10:00:00.000Z",
    content: "",
    truncated: false,
    binary: false,
  };
}
