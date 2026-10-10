import { isRecord } from "../../shared/unknownValues";
import { withStatusChanges } from "../../shared/statusChanges";

/** A socket frame once a status delta in it is made whole, or a delta that could not be laid over a status. */
export type DecodedStatusFrame =
  | { readonly kind: "frame"; readonly raw: unknown }
  | { readonly kind: "out-of-step" };

const DELTA_ONLY_FIELDS: ReadonlySet<string> = new Set(["type", "sessionId", "set", "unset"]);

/**
 * One connection's statuses, so its `status.changed` frames become whole `status.update` frames
 * before anything reads them, and every reader keeps seeing whole statuses. The daemon sends a
 * socket a session's changes only after that socket received a whole status of the session
 * (shared/statusChanges.ts), so a delta with nothing under it, or one not shaped as a delta, means
 * this connection is out of step with its daemon: `out-of-step`. Dropping it would build every
 * later status on a stale one, so the connection is closed and reopens from whole statuses.
 */
export class StatusFrameDecoder {
  private readonly statuses = new Map<string, Readonly<Record<string, unknown>>>();

  decode(raw: unknown): DecodedStatusFrame {
    if (!isRecord(raw)) return { kind: "frame", raw };
    if (raw["type"] === "status.update") {
      this.remember(raw["status"]);
      return { kind: "frame", raw };
    }
    if (raw["type"] !== "status.changed") return { kind: "frame", raw };
    const sessionId = raw["sessionId"];
    const set = raw["set"];
    const unset = raw["unset"];
    const base = typeof sessionId === "string" ? this.statuses.get(sessionId) : undefined;
    if (base === undefined || typeof sessionId !== "string" || !isRecord(set) || !isStringList(unset)) return { kind: "out-of-step" };
    const status = withStatusChanges(base, { set, unset });
    this.statuses.set(sessionId, status);
    const stamp = Object.fromEntries(Object.entries(raw).filter(([key]) => !DELTA_ONLY_FIELDS.has(key)));
    return { kind: "frame", raw: { ...stamp, type: "status.update", status } };
  }

  private remember(status: unknown): void {
    if (!isRecord(status) || typeof status["sessionId"] !== "string") return;
    this.statuses.set(status["sessionId"], status);
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
