/**
 * One request in flight per identity.
 *
 * Several surfaces ask for the same thing at the same moment - a session switch
 * refreshes status, the panel behind it asks for the same status, a reconnect
 * asks again - and each ask was its own round trip. The duplicates cost latency
 * on exactly the interaction the reader is watching, and on a slow link they
 * queue behind each other.
 *
 * What is shared is the response body, not a parsed value: each caller parses
 * the same bytes with its own parser. The body is shared read-only by
 * convention - a parser that mutated it would leak mutations across callers -
 * so parsers stay constructive. Only reads are shared - two sends
 * that look identical are two messages, and what makes a repeat safe lives in
 * the daemon's operation ledger, not here.
 */
const inFlight = new Map<string, Promise<unknown>>();

export function dedupeKey(url: string, method: string | undefined): string | undefined {
  const verb = (method ?? "GET").toUpperCase();
  return verb === "GET" ? `GET ${url}` : undefined;
}

/**
 * Share one unsettled read. The entry is dropped as soon as it settles: this is
 * a shared flight, not a cache, so a later ask is a fresh read.
 */
export function shareInFlight(key: string | undefined, start: () => Promise<unknown>): Promise<unknown> {
  if (key === undefined) return start();
  const existing = inFlight.get(key);
  if (existing !== undefined) return existing;
  const pending = start().finally(() => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

/** How many reads are currently shared. For tests and diagnostics only. */
export function inFlightCount(): number {
  return inFlight.size;
}

export function resetInFlight(): void {
  inFlight.clear();
}
