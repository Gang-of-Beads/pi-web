import type { DeleteWorkspaceFileResponse, FileContentResponse, FileTreeResponse, MoveWorkspaceFileOptions, MoveWorkspaceFileResponse, WriteWorkspaceFileOptions, WriteWorkspaceFileResponse, Workspace } from "../api";
import type { WorkspaceUploadBatchProgress, WorkspaceUploadCancelHandle } from "../../../shared/pluginApiTypes";
import { uploadWorkspaceFiles } from "../api/workspaceUploads";
import { workspaceFilePreviewUrl } from "../api/urls";
import { MAX_INLINE_PREVIEW_BYTES, MAX_STREAM_PREVIEW_BYTES } from "../../../shared/workspaceFiles";
import type { WorkspaceFiles } from "./types";

/**
 * API surface the workspace files helper needs. Structurally satisfied by
 * `workspacesApi`; declared here so the helper stays testable with fakes.
 */
export interface WorkspaceFilesApi {
  workspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<FileContentResponse>;
  workspaceTree(projectId: string, workspaceId: string, path?: string, machineId?: string): Promise<FileTreeResponse>;
  writeWorkspaceFile(projectId: string, workspaceId: string, path: string, content: string | Uint8Array, options?: WriteWorkspaceFileOptions, machineId?: string): Promise<WriteWorkspaceFileResponse>;
  deleteWorkspaceFile(projectId: string, workspaceId: string, path: string, machineId?: string): Promise<DeleteWorkspaceFileResponse>;
  moveWorkspaceFile(projectId: string, workspaceId: string, fromPath: string, toPath: string, options?: MoveWorkspaceFileOptions, machineId?: string): Promise<MoveWorkspaceFileResponse>;
}

/**
 * Build the `files` helper exposed to workspace panel and label callbacks.
 * Every call is bound to the callback's workspace and machine, so local and
 * federated machines behave the same. `onFilesChanged` runs after a mutation
 * succeeds so the host can refresh its file explorer.
 */
export function createWorkspaceFiles(api: WorkspaceFilesApi, workspace: Pick<Workspace, "id" | "projectId">, machineId: string, onFilesChanged?: () => void): WorkspaceFiles {
  return {
    readFile: (path) => api.workspaceFile(workspace.projectId, workspace.id, path, machineId),
    listFiles: (path) => api.workspaceTree(workspace.projectId, workspace.id, path, machineId),
    writeFile: async (path, content, options) => {
      const result = await api.writeWorkspaceFile(workspace.projectId, workspace.id, path, content, options, machineId);
      onFilesChanged?.();
      return result;
    },
    deleteFile: async (path) => {
      const result = await api.deleteWorkspaceFile(workspace.projectId, workspace.id, path, machineId);
      onFilesChanged?.();
      return result;
    },
    moveFile: async (fromPath, toPath, options) => {
      const result = await api.moveWorkspaceFile(workspace.projectId, workspace.id, fromPath, toPath, options, machineId);
      onFilesChanged?.();
      return result;
    },
    previewUrl: (path, options) => workspaceFilePreviewUrl(workspace.projectId, workspace.id, path, {
      ...(options?.modifiedAt === undefined ? {} : { modifiedAt: options.modifiedAt }),
      ...(options?.download === undefined ? {} : { download: options.download }),
      machineId,
    }),
    limits: { inlinePreviewBytes: MAX_INLINE_PREVIEW_BYTES, streamPreviewBytes: MAX_STREAM_PREVIEW_BYTES },
    uploadFiles: (files, options) => {
      const task = uploadWorkspaceFiles(workspace.projectId, workspace.id, files, {
        ...(options?.destinationFolder === undefined ? {} : { destinationFolder: options.destinationFolder }),
        ...(options?.createDirs === undefined ? {} : { createDirs: options.createDirs }),
        ...(options?.overwrite === undefined ? {} : { overwrite: options.overwrite }),
        machineId,
        onProgress: (progress: WorkspaceUploadBatchProgress) => { options?.onProgress?.(progress); },
      });
      const handle: WorkspaceUploadCancelHandle = { promise: task.promise, cancel: () => { task.cancel(); } };
      return handle;
    },
  };
}
