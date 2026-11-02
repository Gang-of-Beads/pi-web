import { open, type FileHandle } from "node:fs/promises";
import type {
  PluginPathAccessConfig,
  ServerPluginExecFileRequest,
  ServerPluginExecFileResult,
  ServerPluginStageRequest,
} from "@gang-of-beads/pi-web/server-plugin-api";
import { fileStageProducer, stagedKind, type FileStageName } from "./fileStages.js";
import { workspaceFilePreviewResponsePolicy, type WorkspaceFilePreviewResponsePolicy } from "./filePreviewResponsePolicy.js";
import { classifyWorkspaceFile, workspaceFilePreviewByteLimit } from "./workspaceFiles.js";
import { resolveWorkspacePathAccessTarget } from "./pathAccessPolicy.js";

/**
 * A workspace file opened for a preview or download answer: how to label the
 * answer, and the descriptor to answer with.
 *
 * `file` is the descriptor that was validated, and the answer reads only from
 * it: path resolution is a snapshot, so a rename, symlink swap or resize after
 * validation cannot change which file the answer carries or move it outside the
 * workspace or an allowed root. The route hands it to `reply.sendFile`, which
 * owns it from then on.
 */
export interface WorkspaceFilePreview {
  readonly policy: WorkspaceFilePreviewResponsePolicy;
  readonly file: FileHandle;
}

export interface OpenWorkspaceFilePreviewOptions {
  /** Answers any file as an opaque attachment, whatever its type and size. */
  download?: boolean;
}

export async function openWorkspaceFilePreview(
  rootPath: string,
  path: string | undefined,
  pathAccess?: PluginPathAccessConfig,
  options: OpenWorkspaceFilePreviewOptions = {},
): Promise<WorkspaceFilePreview> {
  const download = options.download === true;
  const opened = await openWorkspaceFile(rootPath, path, pathAccess, (displayPath, size) => {
    if (!download) requireInlinePreview(displayPath, size);
    return workspaceFilePreviewResponsePolicy(displayPath, { download });
  });
  return { policy: opened.accepted, file: opened.file };
}

/**
 * A workspace file opened for one of its preview stages: the same path checks as a preview, the
 * stage named for its type, and its producer. No size limit applies: a stage is made where the file
 * is and only the stage travels, so a photo too large to preview whole still shows its thumbnail.
 * The tools read the file by its resolved path, so only the file's version comes from the
 * descriptor; `reply.sendStage` closes it.
 */
export async function openWorkspaceFileStage(
  rootPath: string,
  path: string | undefined,
  pathAccess: PluginPathAccessConfig | undefined,
  stage: FileStageName,
  exec: (request: ServerPluginExecFileRequest) => Promise<ServerPluginExecFileResult>,
): Promise<Pick<ServerPluginStageRequest, "file" | "path" | "produce">> {
  const opened = await openWorkspaceFile(rootPath, path, pathAccess, (displayPath, _size, target) => {
    const kind = stagedKind(displayPath);
    const produce = kind === undefined ? undefined : fileStageProducer(stage, kind, target, exec);
    if (produce === undefined) throw new Error(`This file type has no ${stage} preview stage`);
    return produce;
  });
  return { file: opened.file, path: opened.target, produce: opened.accepted };
}

/**
 * Opens the regular file `path` names, after the workspace's path checks, and lets `accept` refuse
 * it by its displayed path and size or derive what the answer needs; a refused file is closed.
 */
async function openWorkspaceFile<T>(
  rootPath: string,
  path: string | undefined,
  pathAccess: PluginPathAccessConfig | undefined,
  accept: (displayPath: string, size: number, target: string) => T,
): Promise<{ file: FileHandle; target: string; accepted: T }> {
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);
  const file = await open(target, "r");
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Path is not a file");
    return { file, target, accepted: accept(displayPath, stats.size, target) };
  } catch (error) {
    await file.close();
    throw error;
  }
}

function requireInlinePreview(displayPath: string, size: number): void {
  const classification = classifyWorkspaceFile(displayPath);
  if (classification === undefined || !("previewMimeType" in classification)) throw new Error("Inline preview is not supported for this file type");
  const limit = workspaceFilePreviewByteLimit(classification);
  if (size > limit.bytes) throw new Error(`File is too large to preview (limit ${limit.label})`);
}
