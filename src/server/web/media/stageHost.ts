import { join } from "node:path";
import type { ServerPluginMediaTools } from "../../../server-plugin-api.js";
import { createMediaToolFinder } from "./mediaTools.js";
import { StageCache } from "./stageCache.js";

/** What plugin routes' stage answers share in the web process: one cache and this machine's tools. */
export interface StageHost {
  readonly cache: StageCache;
  readonly tools: () => Promise<ServerPluginMediaTools>;
}

/** 256 MB holds about twenty thousand 512 px thumbnails. */
const STAGE_CACHE_CAP_BYTES = 256 * 1024 * 1024;
/** Two at a time keeps a burst of thumbnails from starving the machine's other work. */
const STAGE_CONCURRENCY = 2;
/** Measured 0.1 to 0.2 s for a 4000 x 3000 photo's thumbnail or a 1080p video's cover. */
const STAGE_PRODUCE_TIMEOUT_MS = 10_000;

export function createStageHost(dataDir: string): StageHost {
  return {
    cache: new StageCache({
      directory: join(dataDir, "stage-cache"),
      capBytes: STAGE_CACHE_CAP_BYTES,
      concurrency: STAGE_CONCURRENCY,
      produceTimeoutMs: STAGE_PRODUCE_TIMEOUT_MS,
    }),
    tools: createMediaToolFinder(),
  };
}
