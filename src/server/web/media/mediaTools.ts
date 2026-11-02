import { execFile } from "node:child_process";
import type { ServerPluginMediaTools } from "../../../server-plugin-api.js";

/**
 * The image and video tools this machine has, found once, when the first stage is asked for: ffmpeg
 * and ffprobe, and ImageMagick, 7's `magick` or, outside Windows, 6's `convert` and `identify` (on
 * Windows `convert` is the disk tool of that name). Stage producers read them to pick a command; a
 * missing tool means that stage cannot be made here, and the browser goes on to the next stage. A
 * tool installed later counts after a restart.
 */

/** Runs a probe and answers its output, or `undefined` when the command is missing or fails. */
export type ToolProbe = (command: string, args: readonly string[]) => Promise<string | undefined>;

const PROBE_TIMEOUT_MS = 5_000;

export function createMediaToolFinder(probe: ToolProbe = probeTool, platform: NodeJS.Platform = process.platform): () => Promise<ServerPluginMediaTools> {
  let found: Promise<ServerPluginMediaTools> | undefined;
  return () => {
    found ??= findMediaTools(probe, platform);
    return found;
  };
}

async function findMediaTools(probe: ToolProbe, platform: NodeJS.Platform): Promise<ServerPluginMediaTools> {
  const [ffmpeg, ffprobe, magick, convert] = await Promise.all([
    probe("ffmpeg", ["-hide_banner", "-version"]),
    probe("ffprobe", ["-hide_banner", "-version"]),
    probe("magick", ["-version"]),
    platform === "win32" ? Promise.resolve(undefined) : probe("convert", ["-version"]),
  ]);
  const imagemagick = isImageMagick(magick)
    ? { convert: ["magick"], identify: ["magick", "identify"] }
    : isImageMagick(convert) ? { convert: ["convert"], identify: ["identify"] } : undefined;
  return {
    ...(ffmpeg?.startsWith("ffmpeg version") === true ? { ffmpeg: "ffmpeg" } : {}),
    ...(ffprobe?.startsWith("ffprobe version") === true ? { ffprobe: "ffprobe" } : {}),
    ...(imagemagick === undefined ? {} : { imagemagick }),
  };
}

function isImageMagick(output: string | undefined): boolean {
  return output?.includes("ImageMagick") === true;
}

function probeTool(command: string, args: readonly string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(command, [...args], { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024 }, (error, stdout) => {
      resolve(error === null ? stdout : undefined);
    });
  });
}
