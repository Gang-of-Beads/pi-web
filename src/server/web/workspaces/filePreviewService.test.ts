import { appendFile, symlink, truncate, unlink, writeFile } from "node:fs/promises";
import type { Readable } from "node:stream";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_INLINE_PREVIEW_BYTES } from "../../../shared/workspaceFiles.js";
import { cleanupTempWorkspaces, createTempWorkspace } from "./fileContentService.testSupport.js";
import { parseWorkspaceFileRange, readWorkspaceFilePreview } from "./filePreviewService.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

async function previewText(body: Buffer | Readable): Promise<string> {
  if (Buffer.isBuffer(body)) return body.toString("utf8");
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    if (!Buffer.isBuffer(chunk)) throw new Error("Expected binary preview chunks");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

describe("readWorkspaceFilePreview", () => {
  it("previews only supported types within the preview size limit", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "diagram.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    await writeFile(join(root, "note.txt"), "hello");
    await writeFile(join(root, "README.md"), "# Read me\n");
    await writeFile(join(root, "huge.png"), "");
    await truncate(join(root, "huge.png"), MAX_INLINE_PREVIEW_BYTES + 1);

    const preview = await readWorkspaceFilePreview(root, "diagram.svg");

    expect(preview).toMatchObject({ path: "diagram.svg", filename: "diagram.svg", mediaType: "image", size: 46 });
    expect(await previewText(preview.body)).toHaveLength(46);
    await expect(readWorkspaceFilePreview(root, "note.txt")).rejects.toThrow("Inline preview is not supported");
    await expect(readWorkspaceFilePreview(root, "README.md")).rejects.toThrow("Inline preview is not supported");
    await expect(readWorkspaceFilePreview(root, "huge.png")).rejects.toThrow("File is too large to preview");
  });

  it("serves any file as an octet-stream attachment in download mode, ignoring the size cap", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "note.txt"), "hello");
    await writeFile(join(root, "huge.png"), "");
    await truncate(join(root, "huge.png"), MAX_INLINE_PREVIEW_BYTES + 1);

    const textDownload = await readWorkspaceFilePreview(root, "note.txt", undefined, { download: true });
    expect(textDownload).toMatchObject({ filename: "note.txt", size: 5 });
    expect(textDownload.mediaType).toBeUndefined();
    expect(await previewText(textDownload.body)).toBe("hello");

    // Download mode bypasses the inline size cap.
    const bigDownload = await readWorkspaceFilePreview(root, "huge.png", undefined, { download: true });
    expect(bigDownload.size).toBe(MAX_INLINE_PREVIEW_BYTES + 1);
    if (Buffer.isBuffer(bigDownload.body)) throw new Error("Expected an oversized download to stream");
    bigDownload.body.destroy();
  });

  it("retains preview path containment for inline and download requests", async () => {
    const root = await createTempWorkspace();
    const external = await createTempWorkspace();
    await writeFile(join(external, "outside.html"), "<h1>outside</h1>");
    const escapedPath = join("..", basename(external), "outside.html");

    await expect(readWorkspaceFilePreview(root, escapedPath)).rejects.toThrow("Path traversal is not allowed");
    await expect(readWorkspaceFilePreview(root, escapedPath, undefined, { download: true })).rejects.toThrow("Path traversal is not allowed");

    const allowed = await readWorkspaceFilePreview(root, join(external, "outside.html"), { allowedPaths: [external] });
    expect(allowed).toMatchObject({ path: join(external, "outside.html"), mediaType: "html" });
    expect(await previewText(allowed.body)).toBe("<h1>outside</h1>");
  });

  it("returns inline previews as a snapshot of the validated file", async () => {
    const root = await createTempWorkspace();
    const external = await createTempWorkspace();
    await writeFile(join(external, "secret.html"), "<h1>outside secret</h1>");
    await writeFile(join(root, "report.html"), "<h1>safe</h1>");

    const preview = await readWorkspaceFilePreview(root, "report.html");
    await unlink(join(root, "report.html"));
    await symlink(join(external, "secret.html"), join(root, "report.html"));

    expect(await previewText(preview.body)).toBe("<h1>safe</h1>");
    expect(preview.size).toBe(13);
    expect(Buffer.isBuffer(preview.body) ? preview.body.byteLength : -1).toBe(preview.size);
  });

  it("serves empty files as an explicit zero-length body in both modes", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "empty.html"), "");
    await writeFile(join(root, "empty.bin"), "");

    const inline = await readWorkspaceFilePreview(root, "empty.html");
    const download = await readWorkspaceFilePreview(root, "empty.bin", undefined, { download: true });

    expect(inline.size).toBe(0);
    expect(await previewText(inline.body)).toBe("");
    expect(download.size).toBe(0);
    expect(await previewText(download.body)).toBe("");
  });

  it("keeps download bytes bound to the descriptor validated before the swap", async () => {
    const root = await createTempWorkspace();
    const external = await createTempWorkspace();
    await writeFile(join(external, "secret.txt"), "OUTSIDE-SECRET");
    await writeFile(join(root, "note.txt"), "SAFE");

    const preview = await readWorkspaceFilePreview(root, "note.txt", undefined, { download: true });
    // The path is replaced with an out-of-root symlink after validation and
    // before the body is read: the response must not follow it.
    await unlink(join(root, "note.txt"));
    await symlink(join(external, "secret.txt"), join(root, "note.txt"));

    expect(await previewText(preview.body)).toBe("SAFE");
    expect(preview.size).toBe(4);
  });

  it("never streams more than the validated size when the file grows", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "growing.bin"), "12345");

    const preview = await readWorkspaceFilePreview(root, "growing.bin", undefined, { download: true });
    await appendFile(join(root, "growing.bin"), "X".repeat(4096));

    const streamed = await previewText(preview.body);
    expect(streamed).toBe("12345");
    expect(Buffer.byteLength(streamed)).toBe(preview.size);
  });

  it("fails the response instead of under-running the advertised size when the file shrinks", async () => {
    const root = await createTempWorkspace();
    // Larger than the read stream's buffer so the shrink lands mid-transfer
    // rather than after the whole file is already buffered.
    const size = 1024 * 1024;
    await writeFile(join(root, "shrinking.bin"), "x".repeat(size));

    const preview = await readWorkspaceFilePreview(root, "shrinking.bin", undefined, { download: true });
    await truncate(join(root, "shrinking.bin"), 1024);

    expect(preview.size).toBe(size);
    await expect(previewText(preview.body)).rejects.toThrow("File changed while it was being read");
  });
});

describe("readWorkspaceFilePreview media streaming", () => {
  it("previews media beyond the snapshot limit as a stream instead of refusing it", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "clip.mp4"), "");
    await truncate(join(root, "clip.mp4"), MAX_INLINE_PREVIEW_BYTES + 1);

    const preview = await readWorkspaceFilePreview(root, "clip.mp4");

    expect(preview).toMatchObject({ mediaType: "video", size: MAX_INLINE_PREVIEW_BYTES + 1, streamed: true });
    expect(Buffer.isBuffer(preview.body)).toBe(false);
    expect(preview.contentRange).toBeUndefined();
    if (Buffer.isBuffer(preview.body)) throw new Error("Expected a streamed media preview");
    preview.body.destroy();
  });

  it("answers a single byte range so a media element can seek", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "clip.mp4"), "0123456789");

    const head = await readWorkspaceFilePreview(root, "clip.mp4", undefined, { range: "bytes=0-3" });
    expect(head).toMatchObject({ size: 4, streamed: true, contentRange: "bytes 0-3/10" });
    expect(await previewText(head.body)).toBe("0123");

    const tail = await readWorkspaceFilePreview(root, "clip.mp4", undefined, { range: "bytes=6-" });
    expect(tail).toMatchObject({ size: 4, contentRange: "bytes 6-9/10" });
    expect(await previewText(tail.body)).toBe("6789");

    const suffix = await readWorkspaceFilePreview(root, "clip.mp4", undefined, { range: "bytes=-2" });
    expect(suffix).toMatchObject({ size: 2, contentRange: "bytes 8-9/10" });
    expect(await previewText(suffix.body)).toBe("89");
  });

  it("serves the whole file when the range is absent, malformed, or unsatisfiable", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "clip.mp4"), "0123456789");

    for (const range of [undefined, "", "bytes=", "bytes=abc-1", "bits=0-1", "bytes=99-120", "bytes=0-3,7-9"]) {
      const preview = await readWorkspaceFilePreview(root, "clip.mp4", undefined, { range });
      expect(preview.contentRange).toBeUndefined();
      expect(preview.size).toBe(10);
      expect(await previewText(preview.body)).toBe("0123456789");
    }
  });

  it.each([
    ["bytes=0-3", { start: 0, end: 3 }],
    ["bytes=4-", { start: 4, end: 9 }],
    ["  bytes=2-4  ", { start: 2, end: 4 }],
    ["bytes=8-99", { start: 8, end: 9 }],
    ["bytes=10-12", undefined],
    ["bytes=-0", undefined],
    ["bytes=0-0", { start: 0, end: 0 }],
  ])("parses the range %s within a 10-byte file", (range, expected) => {
    expect(parseWorkspaceFileRange(range, 10)).toEqual(expected);
  });
});
