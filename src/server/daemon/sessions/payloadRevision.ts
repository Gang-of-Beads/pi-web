import { createHash } from "node:crypto";

/**
 * Stateless payload revision for cheap background refreshes.
 *
 * The client echoes back the revision it stored from the previous listing;
 * a match answers `{ revision, unchanged: true }` instead of the full
 * payload. The hash is recomputed from the fresh payload on every request,
 * so there is no server-side revision state to invalidate.
 *
 * A SHA-1 of the JSON, not the 32-bit FNV it was: a changed listing whose revision collided
 * with the stored one was answered "unchanged", and the page kept the old list.
 */
export function payloadRevision(payload: unknown): string {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}
