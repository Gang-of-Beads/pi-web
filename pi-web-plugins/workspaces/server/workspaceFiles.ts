import type { FileContentMediaType } from "@gang-of-beads/pi-web/plugin-api";

export const MAX_INLINE_PREVIEW_BYTES = 10 * 1024 * 1024;
export const MAX_INLINE_PREVIEW_LABEL = "10 MB";
export const MAX_WORKSPACE_FILE_CONTENT_BYTES = 512 * 1024;

/**
 * Audio and video previews play from HTTP range requests, so a clip far larger
 * than an image stays previewable and this limit only bounds a disk-sized
 * transfer. `MAX_INLINE_PREVIEW_BYTES` bounds every other inline preview, which
 * the browser loads whole.
 */
export const MAX_MEDIA_PREVIEW_BYTES = 512 * 1024 * 1024;
export const MAX_MEDIA_PREVIEW_LABEL = "512 MB";

type WorkspaceFileClassificationDetails =
  | { readonly mediaType: "image"; readonly source: "stream" | "text"; readonly previewMimeType: string }
  | { readonly mediaType: "html"; readonly source: "text"; readonly previewMimeType: "text/html; charset=utf-8" }
  | { readonly mediaType: "pdf"; readonly source: "stream"; readonly previewMimeType: "application/pdf" }
  | { readonly mediaType: "markdown"; readonly source: "text" }
  | { readonly mediaType: "audio"; readonly source: "stream"; readonly previewMimeType: string }
  | { readonly mediaType: "video"; readonly source: "stream"; readonly previewMimeType: string };

/** Internal classification constrained to the public file-response media types. */
export type WorkspaceFileClassification = WorkspaceFileClassificationDetails & {
  readonly mediaType: FileContentMediaType;
};

// Extension classification is shared by JSON source reads, streamed previews,
// and proxy response policy. Keep this an allowlist: only classifications with
// a preview MIME type may be served as browser-rendered bytes.
//
// `source` decides what a JSON file read carries: "text" formats keep capped
// literal UTF-8 source so the viewer can offer Raw mode, while "stream" formats
// stay out of JSON and are only ever served as preview bytes.
const WORKSPACE_FILE_CLASSIFICATIONS: Readonly<Record<string, WorkspaceFileClassification>> = {
  ".avif": { mediaType: "image", source: "stream", previewMimeType: "image/avif" },
  ".bmp": { mediaType: "image", source: "stream", previewMimeType: "image/bmp" },
  ".gif": { mediaType: "image", source: "stream", previewMimeType: "image/gif" },
  ".ico": { mediaType: "image", source: "stream", previewMimeType: "image/x-icon" },
  ".jpeg": { mediaType: "image", source: "stream", previewMimeType: "image/jpeg" },
  ".jpg": { mediaType: "image", source: "stream", previewMimeType: "image/jpeg" },
  ".png": { mediaType: "image", source: "stream", previewMimeType: "image/png" },
  // SVG is markup: it previews as an image but also has readable source, so it
  // keeps literal text for Raw mode.
  ".svg": { mediaType: "image", source: "text", previewMimeType: "image/svg+xml" },
  ".webp": { mediaType: "image", source: "stream", previewMimeType: "image/webp" },
  ".htm": { mediaType: "html", source: "text", previewMimeType: "text/html; charset=utf-8" },
  ".html": { mediaType: "html", source: "text", previewMimeType: "text/html; charset=utf-8" },
  ".pdf": { mediaType: "pdf", source: "stream", previewMimeType: "application/pdf" },
  ".md": { mediaType: "markdown", source: "text" },
  ".markdown": { mediaType: "markdown", source: "text" },
  // The preview MIME type is what the browser's own media element decodes, so an
  // unsupported container still downloads intact rather than rendering blank.
  ".m4a": { mediaType: "audio", source: "stream", previewMimeType: "audio/mp4" },
  ".aac": { mediaType: "audio", source: "stream", previewMimeType: "audio/aac" },
  ".flac": { mediaType: "audio", source: "stream", previewMimeType: "audio/flac" },
  ".m4v": { mediaType: "video", source: "stream", previewMimeType: "video/mp4" },
  ".mkv": { mediaType: "video", source: "stream", previewMimeType: "video/x-matroska" },
  ".mov": { mediaType: "video", source: "stream", previewMimeType: "video/quicktime" },
  ".mp3": { mediaType: "audio", source: "stream", previewMimeType: "audio/mpeg" },
  ".mp4": { mediaType: "video", source: "stream", previewMimeType: "video/mp4" },
  ".oga": { mediaType: "audio", source: "stream", previewMimeType: "audio/ogg" },
  ".ogg": { mediaType: "audio", source: "stream", previewMimeType: "audio/ogg" },
  ".ogv": { mediaType: "video", source: "stream", previewMimeType: "video/ogg" },
  ".wav": { mediaType: "audio", source: "stream", previewMimeType: "audio/wav" },
  ".webm": { mediaType: "video", source: "stream", previewMimeType: "video/webm" },
};

/** The preview limit of a classified file: the range-played one for audio and video, the inline one for the rest. */
export function workspaceFilePreviewByteLimit(classification: WorkspaceFileClassification): { readonly bytes: number; readonly label: string } {
  if (classification.mediaType === "audio" || classification.mediaType === "video") {
    return { bytes: MAX_MEDIA_PREVIEW_BYTES, label: MAX_MEDIA_PREVIEW_LABEL };
  }
  return { bytes: MAX_INLINE_PREVIEW_BYTES, label: MAX_INLINE_PREVIEW_LABEL };
}

export function classifyWorkspaceFile(path: string): WorkspaceFileClassification | undefined {
  const extension = workspaceFileExtension(path);
  return extension === undefined ? undefined : WORKSPACE_FILE_CLASSIFICATIONS[extension];
}

/** The lower-case extension a file's type is read from: from the leaf's last dot, so a file named `.jpg` is a JPEG. */
export function workspaceFileExtension(path: string): string | undefined {
  const slashIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dotIndex = path.lastIndexOf(".");
  return dotIndex <= slashIndex ? undefined : path.slice(dotIndex).toLowerCase();
}

/** Return the leaf filename for either POSIX or Windows-style workspace paths. */
export function workspaceFileName(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return path.slice(separatorIndex + 1);
}
