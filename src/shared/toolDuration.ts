import { isRecord } from "./unknownValues.js";

/**
 * How long a tool ran, as pi records it on a final result (pi 1.1.0: `durationMs` on the tool
 * result message, on `tool_execution_end` and in the tool render context). One reader for the
 * daemon and the page, so a value pi did not record, or one that is not a duration, reads as none
 * everywhere: a result from before 1.1.0 or a call that never finished has no time, not zero.
 */
export function recordedDurationMs(value: unknown): number | undefined {
  const durationMs = isRecord(value) ? value["durationMs"] : undefined;
  return typeof durationMs === "number" && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined;
}
