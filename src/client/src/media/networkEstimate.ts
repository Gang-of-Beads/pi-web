/**
 * How fast this page receives bytes, for the time a stage would take to load. It is measured on the
 * stages themselves, because the browser's own hint can report a fast link that delivers 11 KB/s
 * (a phone with full bars on a congested cell); until a measurement exists the hint stands in. Only
 * a transfer of some size is counted: a small one, such as a thumbnail that loads while the app is
 * still starting, measures its share of a busy link (an 11 KB thumbnail on the S25 link arrived at
 * 2 KB/s beside the app's forty other requests), not the link.
 */
export interface NetworkEstimate {
  record(bytes: number, elapsedMs: number): void;
  estimateMs(bytes: number): number | undefined;
}

const MIN_TIMED_BYTES = 64 * 1024;
/** How much a new measurement moves the estimate: recent links matter more than old ones. */
const NEW_SAMPLE_WEIGHT = 0.5;

export function createNetworkEstimate(hintedBytesPerMs: () => number | undefined = connectionHint): NetworkEstimate {
  let measuredBytesPerMs: number | undefined;
  return {
    record(bytes, elapsedMs) {
      if (bytes < MIN_TIMED_BYTES || elapsedMs <= 0) return;
      const sample = bytes / elapsedMs;
      measuredBytesPerMs = measuredBytesPerMs === undefined ? sample : measuredBytesPerMs + NEW_SAMPLE_WEIGHT * (sample - measuredBytesPerMs);
    },
    estimateMs(bytes) {
      const rate = measuredBytesPerMs ?? hintedBytesPerMs();
      return rate === undefined || rate <= 0 ? undefined : Math.round(bytes / rate);
    },
  };
}

/** The browser's own estimate of the link (`navigator.connection.downlink`) in bytes per millisecond, where it offers one. */
function connectionHint(): number | undefined {
  const connection: unknown = Reflect.get(navigator, "connection");
  const downlink: unknown = typeof connection === "object" && connection !== null ? Reflect.get(connection, "downlink") : undefined;
  return typeof downlink === "number" && downlink > 0 ? (downlink * 1_000_000) / 8 / 1000 : undefined;
}

/** One estimate per page: every staged file measures the same link. */
export const pageNetworkEstimate = createNetworkEstimate();
