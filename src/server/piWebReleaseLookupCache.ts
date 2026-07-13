const DEFAULT_PI_WEB_RELEASE_LOOKUP_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface PiWebReleaseLookup {
  checkedAtMs: number;
  latestVersion?: string;
  error?: string;
}

export interface PiWebReleaseLookupCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

export interface PiWebReleaseLookupOptions {
  force?: boolean;
}

export interface PiWebReleaseLookupCache {
  get(currentVersion: string, options?: PiWebReleaseLookupOptions): Promise<PiWebReleaseLookup>;
}

export function createPiWebReleaseLookupCache(
  load: (currentVersion: string) => Promise<string>,
  options: PiWebReleaseLookupCacheOptions = {},
): PiWebReleaseLookupCache {
  const ttlMs = options.ttlMs ?? DEFAULT_PI_WEB_RELEASE_LOOKUP_CACHE_TTL_MS;
  const now = options.now ?? Date.now;
  let cached: PiWebReleaseLookup | undefined;
  let pending: { promise: Promise<PiWebReleaseLookup>; force: boolean; sequence: number } | undefined;
  let loadSequence = 0;

  return {
    get(currentVersion: string, lookupOptions: PiWebReleaseLookupOptions = {}): Promise<PiWebReleaseLookup> {
      const force = lookupOptions.force === true;
      if (pending?.force === true) return pending.promise;

      const checkedAtMs = now();
      if (!force && cached !== undefined && checkedAtMs - cached.checkedAtMs < ttlMs) return Promise.resolve(cached);
      if (!force && pending !== undefined) return pending.promise;

      const sequence = ++loadSequence;
      const promise = Promise.resolve()
        .then(() => load(currentVersion))
        .then((latestVersion): PiWebReleaseLookup => ({ checkedAtMs, latestVersion }))
        .catch((error: unknown): PiWebReleaseLookup => ({ checkedAtMs, error: error instanceof Error ? error.message : String(error) }))
        .then((lookup) => {
          if (sequence === loadSequence) cached = lookup;
          return lookup;
        })
        .finally(() => {
          if (pending?.sequence === sequence) pending = undefined;
        });
      pending = { promise, force, sequence };
      return promise;
    },
  };
}
