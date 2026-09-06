import type { WorkspaceFiles } from "./types";

/**
 * A full `WorkspaceFiles` stub for tests: every member rejects, so a test
 * overrides only the surface it drives and any unexpected call fails loudly
 * instead of hanging.
 */
export function stubWorkspaceFiles(overrides: Partial<WorkspaceFiles> = {}): WorkspaceFiles {
  const reject = () => Promise.reject(new Error("WorkspaceFiles member not used by this test"));
  return {
    readFile: reject,
    listFiles: reject,
    writeFile: reject,
    deleteFile: reject,
    moveFile: reject,
    previewUrl: (path) => `api/machines/local/projects/p/workspaces/w/file/preview?path=${encodeURIComponent(path)}`,
    limits: { inlinePreviewBytes: 10 * 1024 * 1024, streamPreviewBytes: 512 * 1024 * 1024 },
    uploadFiles: () => ({ promise: Promise.resolve([]), cancel: () => undefined }),
    ...overrides,
  };
}
