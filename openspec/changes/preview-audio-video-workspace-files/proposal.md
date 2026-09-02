## Why

The workspace file viewer already renders images, HTML, PDF, and Markdown inline, but audio and video files fall through to a plain download prompt. Any project whose output is media — video renders, narration takes, exported clips — therefore has to leave PI WEB to inspect its own results, even though the bytes are already inside a workspace the user trusted.

The preview route is the natural place for this: it resolves workspace path access, validates the file before any header is sent, and applies a response policy that keeps preview bytes from becoming active same-origin content. What it cannot do today is carry a media payload: every inline preview is read into memory as one snapshot behind a 10 MB limit, which is sized for text and raster images and is far below a usable clip.

## What Changes

- Classify audio and video extensions (MP4, WebM, MOV, MKV, OGV, M4V, MP3, WAV, OGG, OGA, M4A, AAC, FLAC) as browser-previewable media, extending the public `FileContentMediaType` union with `audio` and `video`.
- Stream media preview bytes from the validated file descriptor instead of snapshotting them, under a separate 512 MB media preview limit. Text and raster previews keep the existing 10 MB snapshot behaviour and limit unchanged.
- Answer single byte-range requests for streamed previews with `206 Partial Content`, `Content-Range`, and `Accept-Ranges`, so a media element can seek without refetching the file.
- Serve media previews under a content security policy that allows media from the preview's own origin while the response stays sandboxed; every other preview kind keeps `media-src 'none'`.
- Render `<video>` and `<audio>` players in the workspace file viewer, reusing the existing preview-failure state when the browser lacks the codec, so Open in new window and Download stay reachable.

### Non-goals

- Do not transcode, thumbnail, or probe media; the browser's own media elements decode the bytes.
- Do not raise the snapshot limit for existing preview kinds, and do not change download mode, which is already uncapped and streamed.
- Do not render media referenced by text inside chat messages; the media must be a workspace file.
- Do not add multipart (`bytes=a-b,c-d`) range support; a single range is what media elements request.

## Capabilities

### New Capabilities

- `workspace-file-preview`: PI WEB serves workspace files as browser-rendered previews, including streamed and seekable audio and video, under per-kind size limits and containment headers.

### Modified Capabilities

- None.

## Impact

- **Public plugin API**: `FileContentMediaType` gains `"audio" | "video"` (additive). `test-fixtures/plugin-api-baseline/shared/pluginApiTypes.d.ts` is updated as part of this change.
- **Server**: `src/shared/workspaceFiles.ts` (classification and limits), `src/server/web/workspaces/filePreviewService.ts` (streaming and range parsing), `src/server/web/workspaces/filePreviewResponsePolicy.ts` (media CSP), `src/server/web/workspaceExplorerRoutes.ts` (206 and range headers).
- **Client**: `src/client/src/components/WorkspaceFileViewer.ts` (media kinds and players).
- **Federation note**: the federated preview proxy buffers up to `MAX_INLINE_PREVIEW_BYTES`, so a media preview larger than 10 MB on a *remote* machine is still refused there. Local previews are unaffected. Follow-up listed in tasks.
