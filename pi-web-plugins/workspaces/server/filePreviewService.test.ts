import { symlink, truncate, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_INLINE_PREVIEW_BYTES } from "./workspaceFiles.js";
import { cleanupTempWorkspaces, createTempWorkspace } from "./fileContentService.testSupport.js";
import { openWorkspaceFilePreview, type WorkspaceFilePreview } from "./filePreviewService.js";

afterEach(async () => {
  await cleanupTempWorkspaces();
});

async function readPreview(preview: WorkspaceFilePreview): Promise<{ readonly size: number; readonly text: string }> {
  try {
    return { size: (await preview.file.stat()).size, text: await preview.file.readFile("utf8") };
  } finally {
    await preview.file.close();
  }
}

async function closedSize(preview: WorkspaceFilePreview): Promise<number> {
  try {
    return (await preview.file.stat()).size;
  } finally {
    await preview.file.close();
  }
}

describe("openWorkspaceFilePreview", () => {
  it("previews only supported types within the preview size limit", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "diagram.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    await writeFile(join(root, "note.txt"), "hello");
    await writeFile(join(root, "README.md"), "# Read me\n");
    await writeFile(join(root, "huge.png"), "");
    await truncate(join(root, "huge.png"), MAX_INLINE_PREVIEW_BYTES + 1);

    const preview = await openWorkspaceFilePreview(root, "diagram.svg");
    const read = await readPreview(preview);

    expect(preview.policy.contentType).toBe("image/svg+xml");
    expect(preview.policy.contentDisposition).toContain("inline; filename=\"diagram.svg\"");
    expect(read.text).toHaveLength(46);
    await expect(openWorkspaceFilePreview(root, "note.txt")).rejects.toThrow("Inline preview is not supported");
    await expect(openWorkspaceFilePreview(root, "README.md")).rejects.toThrow("Inline preview is not supported");
    await expect(openWorkspaceFilePreview(root, "huge.png")).rejects.toThrow("File is too large to preview");
  });

  it("serves any file as an octet-stream attachment in download mode, ignoring the size cap", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "note.txt"), "hello");
    await writeFile(join(root, "huge.png"), "");
    await truncate(join(root, "huge.png"), MAX_INLINE_PREVIEW_BYTES + 1);

    const textDownload = await openWorkspaceFilePreview(root, "note.txt", undefined, { download: true });
    const read = await readPreview(textDownload);
    expect(textDownload.policy.contentType).toBe("application/octet-stream");
    expect(textDownload.policy.contentDisposition).toContain("attachment; filename=\"note.txt\"");
    expect(read.text).toBe("hello");

    // Download mode bypasses the inline size cap.
    const bigDownload = await openWorkspaceFilePreview(root, "huge.png", undefined, { download: true });
    expect(await closedSize(bigDownload)).toBe(MAX_INLINE_PREVIEW_BYTES + 1);
  });

  it("retains preview path containment for inline and download requests", async () => {
    const root = await createTempWorkspace();
    const external = await createTempWorkspace();
    await writeFile(join(external, "outside.html"), "<h1>outside</h1>");
    const escapedPath = join("..", basename(external), "outside.html");

    await expect(openWorkspaceFilePreview(root, escapedPath)).rejects.toThrow("Path traversal is not allowed");
    await expect(openWorkspaceFilePreview(root, escapedPath, undefined, { download: true })).rejects.toThrow("Path traversal is not allowed");

    const allowed = await openWorkspaceFilePreview(root, join(external, "outside.html"), { allowedPaths: [external] });
    const read = await readPreview(allowed);
    expect(allowed.policy.contentType).toBe("text/html; charset=utf-8");
    expect(allowed.policy.contentDisposition).toContain("filename=\"outside.html\"");
    expect(read.text).toBe("<h1>outside</h1>");
  });

  it("keeps inline preview bytes bound to the descriptor validated before the swap", async () => {
    const root = await createTempWorkspace();
    const external = await createTempWorkspace();
    await writeFile(join(external, "secret.html"), "<h1>outside secret</h1>");
    await writeFile(join(root, "report.html"), "<h1>safe</h1>");

    const preview = await openWorkspaceFilePreview(root, "report.html");
    await unlink(join(root, "report.html"));
    await symlink(join(external, "secret.html"), join(root, "report.html"));
    const read = await readPreview(preview);

    expect(read).toEqual({ size: 13, text: "<h1>safe</h1>" });
  });

  it("serves empty files as an explicit zero-length body in both modes", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "empty.html"), "");
    await writeFile(join(root, "empty.bin"), "");

    const inline = await readPreview(await openWorkspaceFilePreview(root, "empty.html"));
    const download = await readPreview(await openWorkspaceFilePreview(root, "empty.bin", undefined, { download: true }));

    expect(inline).toEqual({ size: 0, text: "" });
    expect(download).toEqual({ size: 0, text: "" });
  });

  it("keeps download bytes bound to the descriptor validated before the swap", async () => {
    const root = await createTempWorkspace();
    const external = await createTempWorkspace();
    await writeFile(join(external, "secret.txt"), "OUTSIDE-SECRET");
    await writeFile(join(root, "note.txt"), "SAFE");

    const preview = await openWorkspaceFilePreview(root, "note.txt", undefined, { download: true });
    // The path is replaced with an out-of-root symlink after validation and
    // before the body is read: the response must not follow it.
    await unlink(join(root, "note.txt"));
    await symlink(join(external, "secret.txt"), join(root, "note.txt"));
    const read = await readPreview(preview);

    expect(read).toEqual({ size: 4, text: "SAFE" });
  });
});

describe("openWorkspaceFilePreview media", () => {
  it("previews media beyond the inline limit instead of refusing it", async () => {
    const root = await createTempWorkspace();
    await writeFile(join(root, "clip.mp4"), "");
    await truncate(join(root, "clip.mp4"), MAX_INLINE_PREVIEW_BYTES + 1);

    const preview = await openWorkspaceFilePreview(root, "clip.mp4");
    const size = await closedSize(preview);

    expect(preview.policy.contentType).toBe("video/mp4");
    expect(size).toBe(MAX_INLINE_PREVIEW_BYTES + 1);
  });
});
