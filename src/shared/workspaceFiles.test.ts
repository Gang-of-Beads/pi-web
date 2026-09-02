import { describe, expect, it } from "vitest";
import { classifyWorkspaceFile, MAX_INLINE_PREVIEW_BYTES, MAX_STREAM_PREVIEW_BYTES, workspaceFilePreviewByteLimit, workspaceFileName } from "./workspaceFiles.js";

describe("classifyWorkspaceFile", () => {
  it.each([
    ["PHOTO.AVIF", "image/avif"],
    ["PHOTO.BMP", "image/bmp"],
    ["PHOTO.GIF", "image/gif"],
    ["PHOTO.ICO", "image/x-icon"],
    ["PHOTO.JPEG", "image/jpeg"],
    ["PHOTO.JPG", "image/jpeg"],
    ["PHOTO.PNG", "image/png"],
    ["PHOTO.WEBP", "image/webp"],
  ])("classifies %s as streamed image bytes", (path, previewMimeType) => {
    expect(classifyWorkspaceFile(path)).toEqual({ mediaType: "image", source: "stream", previewMimeType });
  });

  it.each(["PHOTO.SVG", "diagram.svg"])("classifies %s as an image that keeps literal source for Raw mode", (path) => {
    expect(classifyWorkspaceFile(path)).toEqual({ mediaType: "image", source: "text", previewMimeType: "image/svg+xml" });
  });

  it.each(["REPORT.HTM", "REPORT.HTML"])("classifies %s as literal HTML source", (path) => {
    expect(classifyWorkspaceFile(path)).toEqual({ mediaType: "html", source: "text", previewMimeType: "text/html; charset=utf-8" });
  });

  it.each(["notes.MD", "notes.MarkDown"])("classifies %s as literal Markdown source", (path) => {
    expect(classifyWorkspaceFile(path)).toEqual({ mediaType: "markdown", source: "text" });
  });

  it("classifies PDFs as streamed bytes and leaves unsupported extensions unclassified", () => {
    expect(classifyWorkspaceFile("SPEC.PDF")).toEqual({ mediaType: "pdf", source: "stream", previewMimeType: "application/pdf" });
    expect(classifyWorkspaceFile("archive.zip")).toBeUndefined();
    expect(classifyWorkspaceFile("folder.with.dot/file")).toBeUndefined();
  });
});

describe("workspaceFileName", () => {
  it("extracts the real leaf name from POSIX, Windows, and mixed workspace paths", () => {
    expect(workspaceFileName("reports/annual.pdf")).toBe("annual.pdf");
    expect(workspaceFileName(String.raw`C:\reports\annual.pdf`)).toBe("annual.pdf");
    expect(workspaceFileName(String.raw`C:\reports/archive.zip`)).toBe("archive.zip");
  });
});

describe("audio and video classification", () => {
  it.each([
    ["clip.MP4", "video", "video/mp4"],
    ["clip.WEBM", "video", "video/webm"],
    ["clip.MOV", "video", "video/quicktime"],
    ["take.WAV", "audio", "audio/wav"],
    ["take.MP3", "audio", "audio/mpeg"],
    ["voice.OGG", "audio", "audio/ogg"],
  ])("classifies %s as streamed %s bytes", (path, mediaType, previewMimeType) => {
    const classification = classifyWorkspaceFile(path);
    expect(classification).toMatchObject({ mediaType, source: "stream", previewMimeType });
  });

  it("gives streamed media a larger preview limit than snapshotted previews", () => {
    const video = classifyWorkspaceFile("clip.mp4");
    const image = classifyWorkspaceFile("photo.png");
    if (video === undefined || image === undefined) throw new Error("Expected both classifications");
    expect(workspaceFilePreviewByteLimit(video)).toEqual({ bytes: MAX_STREAM_PREVIEW_BYTES, label: "512 MB", streamed: true });
    expect(workspaceFilePreviewByteLimit(image)).toMatchObject({ bytes: MAX_INLINE_PREVIEW_BYTES, streamed: false });
    expect(MAX_STREAM_PREVIEW_BYTES).toBeGreaterThan(MAX_INLINE_PREVIEW_BYTES);
  });
});
