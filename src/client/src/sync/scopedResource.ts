import { classifyReadError, NO_FACT, retryDelayMs, type ReadFact, type ReadMiss, type ReadPhase } from "./readPhase";

/**
 * One shown value per key, kept current by reads that never give up (object
 * model §2.1, B48).
 *
 * Every surface used to carry its own loading flag, its own terminal "failed"
 * and its own retry ladder; the phone board stopped at "Couldn't read the
 * projects on this machine." after one lost answer while the server had
 * answered in under 10 ms. Here a read that gets no answer is scheduled again
 * (1, 2, 4, 8 s, capped at the quiet window) for as long as someone watches
 * the key, and a value is only ever shown under the key it was read for.
 *
 * Reads are driven by `refresh`; `watch` only counts the consumers that keep
 * retries alive. A refresh during a read in flight marks the entry dirty and
 * reads once more when it settles, so the newest ask always gets an answer
 * without two reads racing.
 */
export interface ResourceClock {
  now(): number;
  /** Schedule once; the returned function cancels it. */
  setTimer(callback: () => void, delayMs: number): () => void;
}

const systemClock: ResourceClock = {
  now: () => Date.now(),
  setTimer: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    return () => { clearTimeout(timer); };
  },
};

export interface ScopedResourceSpec<K, V> {
  keyId(key: K): string;
  read(key: K): Promise<V>;
  retryCapMs: number;
  clock?: ResourceClock;
  /**
   * Whether an answer covers every source it is read from. An incomplete one is
   * shown and read again on the shared backoff while the key is watched, as a
   * miss is, but it is an answer: it records no miss, so the app row stays quiet.
   */
  complete?(value: V): boolean;
}

/** Since when a watched key has gone without an answer, and why the latest try got none. */
export interface Unanswered {
  readonly since: number;
  readonly miss: ReadMiss;
}

/** The one that has gone unanswered longer, or whichever exists; the first wins a tie. */
export function earliestUnanswered(first: Unanswered | undefined, second: Unanswered | undefined): Unanswered | undefined {
  if (first === undefined) return second;
  if (second === undefined) return first;
  return second.since < first.since ? second : first;
}

export interface ResourceEntryView<V> {
  readonly phase: ReadPhase;
  readonly fact: ReadFact;
  readonly known: boolean;
  readonly data: V | undefined;
  /** When this key last went without an answer, until one arrives; the app row's grace counts from here. */
  readonly firstMissAt: number | undefined;
}

interface Entry<K, V> {
  readonly key: K;
  phase: ReadPhase;
  fact: ReadFact;
  known: boolean;
  data: V | undefined;
  inFlight: boolean;
  dirty: boolean;
  attempt: number;
  firstMissAt: number | undefined;
  miss: ReadMiss | undefined;
  consumers: number;
  timer: (() => void) | undefined;
  settled: (() => void)[];
  /** Resolved when the attempt in flight settles. */
  current: (() => void)[];
}

const UNREAD: ResourceEntryView<never> = { phase: "syncing", fact: NO_FACT, known: false, data: undefined, firstMissAt: undefined };

export class ScopedResource<K, V> {
  private readonly entries = new Map<string, Entry<K, V>>();
  private readonly listeners = new Set<() => void>();
  private readonly waiters = new Set<() => void>();
  private readonly clock: ResourceClock;
  private disposed = false;

  constructor(private readonly spec: ScopedResourceSpec<K, V>) {
    this.clock = spec.clock ?? systemClock;
  }

  entry(key: K): ResourceEntryView<V> {
    return this.entries.get(this.spec.keyId(key)) ?? UNREAD;
  }

  /** Count a consumer. Retries run only while a key is watched; a watched key that was left reconnecting resumes. */
  watch(key: K): () => void {
    const entry = this.ensure(key);
    entry.consumers += 1;
    if (entry.phase === "reconnecting" && !entry.inFlight && entry.timer === undefined) this.start(entry);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      entry.consumers -= 1;
      if (entry.consumers > 0) return;
      this.cancelRetry(entry);
    };
  }

  /**
   * Wait for the read in flight, without asking for another after it: for a
   * reader who needs an answer that is already being read. Undefined when
   * nothing is in flight.
   */
  join(key: K): Promise<void> | undefined {
    const entry = this.entries.get(this.spec.keyId(key));
    if (entry?.inFlight !== true) return undefined;
    const current = entry.current;
    return new Promise<void>((resolve) => { current.push(resolve); });
  }

  /** Read now, or once more after the read in flight. Resolves when the attempt that covers this ask settles. */
  refresh(key: K): Promise<void> {
    if (this.disposed) return Promise.resolve();
    const entry = this.ensure(key);
    const settled = new Promise<void>((resolve) => { entry.settled.push(resolve); });
    if (entry.inFlight) {
      entry.dirty = true;
      return settled;
    }
    this.cancelRetry(entry);
    this.start(entry);
    return settled;
  }

  /**
   * Read now and wait until the key has an answer: a value (one known from an
   * earlier read counts when this read is lost) or a refusal the server
   * stated. The wait holds a watch, so lost reads keep being retried while it
   * lasts. It ends with undefined once the reader no longer wants the answer,
   * which is checked before reading, each time a read settles and on
   * `recheckWaiters`, or when the resource is disposed.
   */
  async whenAnswered(key: K, wanted: () => boolean): Promise<ResourceEntryView<V> | undefined> {
    if (!this.stillWaiting(wanted)) return undefined;
    const release = this.watch(key);
    try {
      await this.refresh(key);
      while (this.stillWaiting(wanted)) {
        const view = this.entry(key);
        if (view.known || view.fact.kind !== "none") return view;
        await this.nextSettle();
      }
      return undefined;
    } finally {
      release();
    }
  }

  /**
   * The reader's selection may have moved: every `whenAnswered` wait checks
   * whether its answer is still wanted now, instead of at the next settle, which
   * for a lost read can be the full retry cap away.
   */
  recheckWaiters(): void {
    this.releaseWaiters();
  }

  /** A sign of life (the socket opened, the tab became visible, the browser is online): retry every watched key that is waiting. */
  wake(): void {
    for (const entry of this.entries.values()) {
      if (entry.consumers === 0 || entry.phase !== "reconnecting" || entry.inFlight) continue;
      this.cancelRetry(entry);
      this.start(entry);
    }
  }

  /** Change a known value in place, for writes this client made itself. Unknown keys stay unknown. */
  update(key: K, change: (value: V) => V): void {
    const entry = this.entries.get(this.spec.keyId(key));
    if (entry === undefined || !entry.known || entry.data === undefined) return;
    entry.data = change(entry.data);
    this.notify();
  }

  /** The watched key among these that has gone longest without an answer, with why its latest try got none. */
  unanswered(keys: readonly K[]): Unanswered | undefined {
    let earliest: Unanswered | undefined;
    for (const key of keys) {
      const entry = this.entries.get(this.spec.keyId(key));
      if (entry === undefined || entry.consumers === 0 || entry.firstMissAt === undefined || entry.miss === undefined) continue;
      earliest = earliestUnanswered(earliest, { since: entry.firstMissAt, miss: entry.miss });
    }
    return earliest;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.entries.values()) {
      this.cancelRetry(entry);
      for (const resolve of entry.settled.splice(0)) resolve();
    }
    this.listeners.clear();
    this.releaseWaiters();
  }

  private stillWaiting(wanted: () => boolean): boolean {
    return !this.disposed && wanted();
  }

  private nextSettle(): Promise<void> {
    return new Promise((resolve) => { this.waiters.add(resolve); });
  }

  private releaseWaiters(): void {
    const waiting = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiting) resolve();
  }

  private ensure(key: K): Entry<K, V> {
    const id = this.spec.keyId(key);
    const existing = this.entries.get(id);
    if (existing !== undefined) return existing;
    const entry: Entry<K, V> = { key, phase: "syncing", fact: NO_FACT, known: false, data: undefined, inFlight: false, dirty: false, attempt: 0, firstMissAt: undefined, miss: undefined, consumers: 0, timer: undefined, settled: [], current: [] };
    this.entries.set(id, entry);
    return entry;
  }

  private start(entry: Entry<K, V>): void {
    if (this.disposed) return;
    entry.inFlight = true;
    entry.dirty = false;
    if (entry.firstMissAt === undefined && entry.phase !== "live") entry.phase = "syncing";
    const settled = entry.settled.splice(0);
    entry.current = settled;
    this.spec.read(entry.key).then(
      (data) => { this.answered(entry, data, settled); },
      (error: unknown) => { this.missed(entry, error, settled); },
    );
  }

  private answered(entry: Entry<K, V>, data: V, settled: readonly (() => void)[]): void {
    entry.inFlight = false;
    entry.known = true;
    entry.data = data;
    entry.fact = NO_FACT;
    entry.firstMissAt = undefined;
    entry.miss = undefined;
    if (this.spec.complete?.(data) === false) {
      entry.phase = "reconnecting";
      if (!entry.dirty) this.scheduleRetry(entry);
      this.finish(entry, settled);
      return;
    }
    entry.phase = "live";
    entry.attempt = 0;
    this.finish(entry, settled);
  }

  private missed(entry: Entry<K, V>, error: unknown, settled: readonly (() => void)[]): void {
    entry.inFlight = false;
    const outcome = classifyReadError(error);
    if (outcome.kind === "fact") {
      entry.fact = outcome.fact;
      entry.phase = "live";
      entry.attempt = 0;
      entry.firstMissAt = undefined;
      entry.miss = undefined;
      this.finish(entry, settled);
      return;
    }
    entry.phase = "reconnecting";
    entry.fact = NO_FACT;
    entry.miss = outcome.miss;
    entry.firstMissAt ??= this.clock.now();
    if (!entry.dirty) this.scheduleRetry(entry);
    this.finish(entry, settled);
  }

  private finish(entry: Entry<K, V>, settled: readonly (() => void)[]): void {
    this.notify();
    for (const resolve of settled) resolve();
    if (!entry.dirty) return;
    if (this.disposed) {
      for (const resolve of entry.settled.splice(0)) resolve();
      return;
    }
    this.start(entry);
  }

  private scheduleRetry(entry: Entry<K, V>): void {
    if (entry.consumers === 0 || this.disposed) return;
    const delay = retryDelayMs(entry.attempt, this.spec.retryCapMs);
    entry.attempt += 1;
    entry.timer = this.clock.setTimer(() => {
      entry.timer = undefined;
      this.start(entry);
    }, delay);
  }

  private cancelRetry(entry: Entry<K, V>): void {
    if (entry.timer === undefined) return;
    entry.timer();
    entry.timer = undefined;
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
    this.releaseWaiters();
  }
}
