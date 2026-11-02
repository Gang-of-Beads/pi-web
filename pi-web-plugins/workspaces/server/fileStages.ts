import { readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import type {
  ServerPluginExecFileRequest,
  ServerPluginExecFileResult,
  ServerPluginStageJob,
  ServerPluginStageMaking,
} from "@gang-of-beads/pi-web/server-plugin-api";
import { workspaceFileExtension } from "./workspaceFiles.js";

/**
 * The stages a file preview shows before the file itself: `info`, a small JSON of facts (its size in
 * pixels, its duration, a ThumbHash placeholder), `thumbnail-512` for a photo and `poster-512` for a
 * video, both WebP at most 512 pixels on the longer side. Each is made with this machine's own tools,
 * ImageMagick for photos and ffmpeg for videos (ffmpeg for photos too when ImageMagick is missing; a
 * JPEG's EXIF rotation then holds only where ffmpeg reads it), from the one local file the route
 * validated.
 *
 * The file may come from anywhere, such as a cloned repository, so every tool is told which decoder
 * its type names (ImageMagick's coder, ffmpeg's demuxer) instead of guessing from the content: an
 * `.jpg` that is really a drawing script or an `.mp4` that is really a playlist never reaches the
 * decoders that would follow it to other files or the network, and ffmpeg may open local files only
 * and reads a path as it is, never as a numbered sequence. ImageMagick may hold a bounded amount of
 * memory and disk, and ffmpeg a bounded allocation, so a small file that decodes to a huge image
 * fails instead of filling the memory or the disk before the time limit. A tool this machine lacks
 * makes the stage unavailable, which the browser says, never a placeholder pretending to load; so
 * does a file the tool cannot read, such as a photo whose bytes are another type than its name, in
 * the tool's own words, and the browser goes on to the file itself. SVG has no stages: the browser
 * draws it as it is.
 *
 * Stages are cached for a year under the file's version, so a change to what a producer makes must
 * add a revision to the stage cache key and to the stage URL.
 */

export type FileStageName = "info" | "thumbnail-512" | "poster-512";
type StagedMediaType = "image" | "video" | "audio";

export interface FileStageInfo {
  readonly width?: number;
  readonly height?: number;
  readonly durationS?: number;
  /** Base64. */
  readonly thumbhash?: string;
}

/** A type the stages are made for, and the decoders named for it. */
export interface StagedKind {
  readonly media: StagedMediaType;
  /** ImageMagick's coder; photos only. */
  readonly coder?: string;
  /** ffmpeg's and ffprobe's input options naming the demuxer. */
  readonly demuxer: readonly string[];
}

type Exec = (request: ServerPluginExecFileRequest) => Promise<ServerPluginExecFileResult>;
type Producer = (job: ServerPluginStageJob) => Promise<ServerPluginStageMaking>;

const STILL_IMAGE = ["-f", "image2", "-pattern_type", "none"];
const photo = (coder: string, demuxer: readonly string[] = STILL_IMAGE): StagedKind => ({ media: "image", coder, demuxer });
const video = (demuxer: string): StagedKind => ({ media: "video", demuxer: ["-f", demuxer] });
const audio = (demuxer: string): StagedKind => ({ media: "audio", demuxer: ["-f", demuxer] });

const STAGED_KINDS: ReadonlyMap<string, StagedKind> = new Map([
  [".avif", photo("AVIF", ["-f", "mov"])],
  [".bmp", photo("BMP")],
  [".gif", photo("GIF", ["-f", "gif"])],
  [".ico", photo("ICO", ["-f", "ico"])],
  [".jpeg", photo("JPEG")],
  [".jpg", photo("JPEG")],
  [".png", photo("PNG")],
  [".webp", photo("WEBP")],
  [".m4v", video("mov")],
  [".mov", video("mov")],
  [".mp4", video("mov")],
  [".mkv", video("matroska")],
  [".webm", video("matroska")],
  [".ogv", video("ogg")],
  [".m4a", audio("mov")],
  [".aac", audio("aac")],
  [".flac", audio("flac")],
  [".mp3", audio("mp3")],
  [".oga", audio("ogg")],
  [".ogg", audio("ogg")],
  [".wav", audio("wav")],
]);

const STAGES_BY_MEDIA: Record<StagedMediaType, readonly FileStageName[]> = {
  image: ["info", "thumbnail-512"],
  video: ["info", "poster-512"],
  audio: ["info"],
};

export const FILE_STAGE_CONTENT_TYPES: Record<FileStageName, string> = {
  info: "application/json; charset=utf-8",
  "thumbnail-512": "image/webp",
  "poster-512": "image/webp",
};

const STAGE_SIDE = 512;
/** ThumbHash takes at most 100 pixels a side. */
const PLACEHOLDER_SIDE = 100;
const WEBP_QUALITY = "75";
/** Where a video's cover is taken; a shorter video gives its first frame. */
const POSTER_AT_SECONDS = "1";
const FFMPEG_QUIET = ["-nostdin", "-hide_banner", "-loglevel", "error"];
/** The largest single allocation ffmpeg and ffprobe may make: a frame of about 130 megapixels. */
const FFMPEG_ALLOCATION_LIMIT = ["-max_alloc", String(512 * 1024 * 1024)];
const IMAGEMAGICK_LIMITS = ["-limit", "memory", "256MiB", "-limit", "map", "512MiB", "-limit", "disk", "1GiB"];
/** ImageMagick's orientations that turn a photo a quarter, so its width and height swap. */
const QUARTER_TURNS = new Set(["LeftTop", "RightTop", "RightBottom", "LeftBottom"]);

export function isFileStageName(value: string | undefined): value is FileStageName {
  return value !== undefined && Object.hasOwn(FILE_STAGE_CONTENT_TYPES, value);
}

/** The kind of file `path` names, by its extension, when stages are made for it. */
export function stagedKind(path: string): StagedKind | undefined {
  const extension = workspaceFileExtension(path);
  return extension === undefined ? undefined : STAGED_KINDS.get(extension);
}

/** The producer of `stage` for a file of `kind` at `source`, or `undefined` when such a file has no such stage. */
export function fileStageProducer(stage: FileStageName, kind: StagedKind, source: string, exec: Exec): Producer | undefined {
  if (!STAGES_BY_MEDIA[kind.media].includes(stage)) return undefined;
  const producers: Record<FileStageName, Producer> = {
    info: (job) => produceInfo(kind, source, exec, job),
    "thumbnail-512": (job) => produceThumbnail(kind, source, exec, job),
    "poster-512": (job) => producePoster(kind, source, exec, job),
  };
  return producers[stage];
}

async function produceThumbnail(kind: StagedKind, source: string, exec: Exec, job: ServerPluginStageJob): Promise<ServerPluginStageMaking> {
  const { imagemagick, ffmpeg } = job.tools;
  try {
    if (imagemagick !== undefined && kind.coder !== undefined) {
      await run(exec, job, [...imagemagick.convert, ...IMAGEMAGICK_LIMITS, ...jpegReadSize(STAGE_SIDE * 2), `${kind.coder}:${source}[0]`, "-auto-orient", "-thumbnail", `${String(STAGE_SIDE)}x${String(STAGE_SIDE)}>`, "-strip", "-quality", WEBP_QUALITY, `WEBP:${job.output}`]);
      return { made: true };
    }
    if (ffmpeg === undefined) return { unavailable: "this machine has neither ImageMagick nor ffmpeg" };
    await frame(ffmpeg, kind, source, undefined, STAGE_SIDE, webpEncoding(), exec, job, job.output);
    return { made: true };
  } catch (error) {
    return unreadable(error, source, job);
  }
}

async function producePoster(kind: StagedKind, source: string, exec: Exec, job: ServerPluginStageJob): Promise<ServerPluginStageMaking> {
  if (job.tools.ffmpeg === undefined) return { unavailable: "this machine has no ffmpeg" };
  try {
    await frame(job.tools.ffmpeg, kind, source, POSTER_AT_SECONDS, STAGE_SIDE, webpEncoding(), exec, job, job.output);
    return { made: true };
  } catch (error) {
    return unreadable(error, source, job);
  }
}

async function produceInfo(kind: StagedKind, source: string, exec: Exec, job: ServerPluginStageJob): Promise<ServerPluginStageMaking> {
  let probed: FileStageInfo | undefined;
  try {
    probed = await probe(kind, source, exec, job);
  } catch (error) {
    return unreadable(error, source, job);
  }
  if (probed === undefined) return { unavailable: kind.media === "image" ? "this machine has neither ImageMagick nor ffprobe" : "this machine has no ffprobe" };
  const placeholder = kind.media === "audio" ? undefined : await placeholderHash(kind, source, exec, job);
  const info: FileStageInfo = { ...probed, ...(placeholder === undefined ? {} : { thumbhash: placeholder }) };
  await writeFile(job.output, JSON.stringify(info), "utf8");
  return { made: true };
}

/**
 * A tool ran but could not read the file, such as a photo whose bytes are another type than its
 * name or a video without a picture: the stage is unavailable in the tool's own words, which name
 * the file but never where it lives on this machine. Running out of time still fails the stage.
 */
function unreadable(error: unknown, source: string, job: ServerPluginStageJob): ServerPluginStageMaking {
  if (job.signal.aborted) throw error;
  const said = error instanceof Error ? error.message : String(error);
  return { unavailable: said.replaceAll(job.output, "the stage file").replaceAll(source, basename(source)) };
}

/** The file's facts, or `undefined` when no tool here can read them. */
async function probe(kind: StagedKind, source: string, exec: Exec, job: ServerPluginStageJob): Promise<FileStageInfo | undefined> {
  const { imagemagick, ffprobe } = job.tools;
  if (imagemagick !== undefined && kind.coder !== undefined) {
    const answer = await run(exec, job, [...imagemagick.identify, ...IMAGEMAGICK_LIMITS, "-ping", "-format", "%w %h %[orientation]", `${kind.coder}:${source}[0]`]);
    const [width, height, orientation] = answer.trim().split(/\s+/u);
    const turned = orientation !== undefined && QUARTER_TURNS.has(orientation);
    return turned ? dimensions(Number(height), Number(width)) : dimensions(Number(width), Number(height));
  }
  if (ffprobe === undefined) return undefined;
  const answer = await run(exec, job, [ffprobe, "-v", "error", ...FFMPEG_ALLOCATION_LIMIT, "-protocol_whitelist", "file", ...kind.demuxer, "-show_entries", "stream=codec_type,width,height:stream_tags=rotate:stream_side_data=rotation:format=duration", "-of", "json", `file:${source}`]);
  return probedFacts(answer, kind.media);
}

/**
 * The ThumbHash of a 100 pixel version of the photo or of the video's cover frame, when a tool here
 * can make one; a file it cannot decode has none, while running out of time still fails the stage.
 */
async function placeholderHash(kind: StagedKind, source: string, exec: Exec, job: ServerPluginStageJob): Promise<string | undefined> {
  const { imagemagick, ffmpeg } = job.tools;
  const small = `${job.output}.placeholder.tmp`;
  try {
    if (imagemagick !== undefined && kind.coder !== undefined) {
      await run(exec, job, [...imagemagick.convert, ...IMAGEMAGICK_LIMITS, ...jpegReadSize(PLACEHOLDER_SIDE * 2), `${kind.coder}:${source}[0]`, "-auto-orient", "-thumbnail", `${String(PLACEHOLDER_SIDE)}x${String(PLACEHOLDER_SIDE)}`, "-background", "white", "-alpha", "remove", "-depth", "8", `PPM:${small}`]);
    } else if (ffmpeg !== undefined) {
      await frame(ffmpeg, kind, source, kind.media === "video" ? POSTER_AT_SECONDS : undefined, PLACEHOLDER_SIDE, ["-pix_fmt", "rgb24", "-c:v", "ppm", "-f", "image2", "-update", "1"], exec, job, small);
    } else {
      return undefined;
    }
    const image = parsePpm(await readFile(small));
    return image === undefined ? undefined : job.thumbHash(image);
  } catch (error) {
    if (job.signal.aborted) throw error;
    return undefined;
  } finally {
    await rm(small, { force: true }).catch(() => undefined);
  }
}

/**
 * One frame scaled to fit `side`: for a video the one at `at` seconds, or its first frame when it is
 * shorter than that or ffmpeg cannot take one there.
 */
async function frame(ffmpeg: string, kind: StagedKind, source: string, at: string | undefined, side: number, encoding: readonly string[], exec: Exec, job: ServerPluginStageJob, output: string): Promise<void> {
  const starts = at === undefined ? [undefined] : [at, "0"];
  let refused: Error | undefined;
  for (const start of starts) {
    const seek = start === undefined ? [] : ["-ss", start];
    try {
      await run(exec, job, [ffmpeg, ...FFMPEG_QUIET, ...FFMPEG_ALLOCATION_LIMIT, ...seek, "-protocol_whitelist", "file", ...kind.demuxer, "-i", `file:${source}`, "-frames:v", "1", "-vf", fitWithin(side), ...encoding, "-y", output]);
    } catch (error) {
      if (job.signal.aborted || !(error instanceof Error)) throw error;
      refused = error;
      continue;
    }
    if (await hasBytes(output)) return;
    refused = undefined;
  }
  throw refused ?? new Error("the file has no frame to show");
}

function webpEncoding(): readonly string[] {
  return ["-c:v", "libwebp", "-quality", WEBP_QUALITY, "-f", "webp"];
}

/** Lets ImageMagick decode a large JPEG at a fraction of its size when only a small version is wanted. */
function jpegReadSize(side: number): readonly string[] {
  return ["-define", `jpeg:size=${String(side)}x${String(side)}`];
}

function fitWithin(side: number): string {
  return `scale='min(${String(side)},iw)':'min(${String(side)},ih)':force_original_aspect_ratio=decrease`;
}

async function run(exec: Exec, job: ServerPluginStageJob, argv: readonly string[]): Promise<string> {
  const [file, ...args] = argv;
  if (file === undefined) throw new Error("no command to run");
  const result = await exec({ file, args, signal: job.signal });
  if (result.exitCode === 0) return result.stdout;
  const detail = result.stderr.trim().slice(0, 300);
  throw new Error(`${file} failed: ${detail === "" ? `exit ${String(result.exitCode)}` : detail}`);
}

async function hasBytes(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
}

function dimensions(width: number, height: number): FileStageInfo {
  return isPositive(width) && isPositive(height) ? { width, height } : {};
}

/**
 * ffprobe's JSON: the first video stream's size as it plays (a phone records portrait video as
 * landscape frames plus a quarter-turn rotation, in its side data or, from older muxers, a tag) and
 * the container's duration, which a photo read as one frame does not have.
 */
function probedFacts(json: string, media: StagedMediaType): FileStageInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return {};
  }
  const streams: unknown = Reflect.get(Object(parsed), "streams");
  const videoStream: unknown = Array.isArray(streams) ? streams.find((stream: unknown) => Reflect.get(Object(stream), "codec_type") === "video") : undefined;
  const width = Number(Reflect.get(Object(videoStream), "width"));
  const height = Number(Reflect.get(Object(videoStream), "height"));
  const duration = Number(Reflect.get(Object(Reflect.get(Object(parsed), "format")), "duration"));
  const turned = Math.abs(rotation(videoStream)) % 180 === 90;
  return {
    ...(turned ? dimensions(height, width) : dimensions(width, height)),
    ...(media !== "image" && isPositive(duration) ? { durationS: Math.round(duration * 1000) / 1000 } : {}),
  };
}

function rotation(stream: unknown): number {
  const sideData: unknown = Reflect.get(Object(stream), "side_data_list");
  const fromSideData = Array.isArray(sideData) ? sideData.map((entry: unknown) => Number(Reflect.get(Object(entry), "rotation"))).find((value) => Number.isFinite(value)) : undefined;
  if (fromSideData !== undefined) return fromSideData;
  const fromTag = Number(Reflect.get(Object(Reflect.get(Object(stream), "tags")), "rotate"));
  return Number.isFinite(fromTag) ? fromTag : 0;
}

function isPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

/** A binary PPM (P6, 8 bits, at most 100 pixels a side) as RGBA, or `undefined` for anything else. */
function parsePpm(bytes: Buffer): { width: number; height: number; rgba: Uint8Array } | undefined {
  const fields: string[] = [];
  let at = 0;
  while (fields.length < 4 && at < bytes.length) {
    at = afterSpaceAndComments(bytes, at);
    let end = at;
    while (end < bytes.length && !isPpmSpace(bytes[end])) end += 1;
    fields.push(bytes.toString("latin1", at, end));
    at = end;
  }
  const [magic, widthText, heightText, maxText] = fields;
  const width = Number(widthText);
  const height = Number(heightText);
  if (magic !== "P6" || maxText !== "255" || !Number.isInteger(width) || !Number.isInteger(height)) return undefined;
  if (width < 1 || height < 1 || width > PLACEHOLDER_SIDE || height > PLACEHOLDER_SIDE) return undefined;
  const pixels = bytes.subarray(at + 1);
  if (pixels.length < width * height * 3) return undefined;
  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    rgba.set(pixels.subarray(pixel * 3, pixel * 3 + 3), pixel * 4);
    rgba[pixel * 4 + 3] = 255;
  }
  return { width, height, rgba };
}

function afterSpaceAndComments(bytes: Buffer, from: number): number {
  let at = from;
  while (at < bytes.length) {
    if (isPpmSpace(bytes[at])) {
      at += 1;
    } else if (bytes[at] === 0x23) {
      while (at < bytes.length && bytes[at] !== 0x0a) at += 1;
    } else {
      return at;
    }
  }
  return at;
}

function isPpmSpace(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}
