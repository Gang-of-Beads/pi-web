import type { StagedFileStageKind } from "../../../shared/pluginApiTypes";

/**
 * Which preview stages load without the reader asking, one rule for every plugin so none can load
 * more than the reader agreed to. Facts and small images load as soon as the stage before them is
 * shown; a photo's original follows on its own (the default the owner chose; a setting to load it
 * only on a fast network, or only when asked, comes later); audio and video never start by
 * themselves: how they load is the plugin's, which asks with `advance()`.
 */
const LOADS_UNASKED: Record<StagedFileStageKind, boolean> = {
  info: true,
  image: true,
  "original-image": true,
  "original-stream": false,
};

export function loadsUnasked(kind: StagedFileStageKind): boolean {
  return LOADS_UNASKED[kind];
}
