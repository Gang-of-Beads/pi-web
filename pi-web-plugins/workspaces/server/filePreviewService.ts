import { open, type FileHandle } from "node:fs/promises";
import type { PluginPathAccessConfig } from "@gang-of-beads/pi-web/server-plugin-api";
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
  if (path === undefined || path === "") throw new Error("path query parameter is required");
  const { target, displayPath } = await resolveWorkspacePathAccessTarget(rootPath, path, pathAccess);
  const download = options.download === true;
  const file = await open(target, "r");
  try {
    const stats = await file.stat();
    if (!stats.isFile()) throw new Error("Path is not a file");
    if (!download) requireInlinePreview(displayPath, stats.size);
    return { policy: workspaceFilePreviewResponsePolicy(displayPath, { download }), file };
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
