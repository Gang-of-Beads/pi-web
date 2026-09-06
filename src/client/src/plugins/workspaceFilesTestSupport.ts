import type { FileContentResponse, FileTreeResponse, WriteWorkspaceFileResponse } from "../../../shared/pluginApiTypes";

/**
 * Structural twin of the host's `WorkspaceFiles` seam, kept import-free so a
 * test helper never drags the client compile graph into the plugins tsconfig.
 * The tests that assign this stub into a `WorkspaceFiles` field fail to
 * compile if the shapes drift apart, which is the drift guard.
 */
export interface StubWorkspaceFiles {
  readFile(path: string): Promise<FileContentResponse>;
  listFiles(path: string): Promise<FileTreeResponse>;
  writeFile(path: string, content: string | Uint8Array, options?: { createDirs?: boolean; overwrite?: boolean }): Promise<WriteWorkspaceFileResponse>;
  deleteFile(path: string): Promise<{ path: string; existed: boolean }>;
  moveFile(fromPath: string, toPath: string, options?: { overwrite?: boolean }): Promise<{ fromPath: string; toPath: string; size: number; modifiedAt: string }>;
  previewUrl(path: string, options?: { modifiedAt?: string; download?: boolean }): string;
  readonly limits: { readonly inlinePreviewBytes: number; readonly streamPreviewBytes: number };
  uploadFiles(files: readonly File[], options?: {
    destinationFolder?: string;
    createDirs?: boolean;
    overwrite?: boolean;
    onProgress?: (progress: unknown) => void;
  }): { promise: Promise<WriteWorkspaceFileResponse[]>; cancel(): void };
  readonly uploadFolder: string;
}

/**
 * A full `WorkspaceFiles` stub for tests: every member rejects, so a test
 * overrides only the surface it drives and any unexpected call fails loudly
 * instead of hanging.
 */
export function stubWorkspaceFiles(overrides: Partial<StubWorkspaceFiles> = {}): StubWorkspaceFiles {
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
    uploadFolder: ".pi-web/uploads",
    ...overrides,
  };
}
