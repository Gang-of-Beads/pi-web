/**
 * Stateless payload revision for cheap background refreshes.
 *
 * The client echoes back the revision it stored from the previous listing;
 * a match answers `{ revision, unchanged: true }` instead of the full
 * payload. The hash is recomputed from the fresh payload on every request,
 * so there is no server-side revision state to invalidate.
 */
export function payloadRevision(payload: unknown): string {
  return fnv1aHex(JSON.stringify(payload));
}

function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
