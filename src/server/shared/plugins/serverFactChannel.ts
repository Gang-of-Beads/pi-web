import type { ServerFact, ServerFactKind, ServerFactListener, ServerPluginEvents } from "../../../server-plugin-api.js";
import { errorMessage } from "../../../shared/unknownValues.js";

/**
 * Where the web process hears its daemon's server facts: a websocket on the daemon's own socket,
 * one JSON fact per frame. The web process does not forward this path from browsers.
 */
export const SERVER_FACTS_PATH = "/plugins/facts";

/** A fact the daemon decided; `facts.resumed` is never carried, each plugin's channel says it. */
export type SessionServerFact = Exclude<ServerFact, { kind: "facts.resumed" }>;

export type ServerFactLinkState = "up" | "down";

export interface ServerFactFeedSubscriber {
  fact(fact: SessionServerFact): void;
  link(state: ServerFactLinkState): void;
}

/**
 * Where one process's facts come from. The daemon produces them and is always linked; the web
 * process relays them and is linked only while it holds its connection to the daemon, during
 * which every fact the daemon decided reaches it.
 */
export interface ServerFactFeed {
  linked(): boolean;
  subscribe(subscriber: ServerFactFeedSubscriber): () => void;
}

export interface ServerFactChannelLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

/** Whether the plugin has heard every fact since it began listening (`live`) or may have missed some (`gap`). */
type ChannelLink = "live" | "gap";
type FeedSignal = ServerFactLinkState | "fact";

/**
 * A plugin that may have missed facts is told so before anything else reaches it: absence is
 * not negation, so silence while the relay was down must never read as "nothing happened".
 */
const LINK_STEPS: Readonly<Record<ChannelLink, Readonly<Record<FeedSignal, { next: ChannelLink; announceResumed: boolean }>>>> = {
  live: { up: { next: "live", announceResumed: false }, down: { next: "gap", announceResumed: false }, fact: { next: "live", announceResumed: false } },
  gap: { up: { next: "live", announceResumed: true }, down: { next: "gap", announceResumed: false }, fact: { next: "live", announceResumed: true } },
};

interface ListenerEntry {
  readonly kind: ServerFactKind;
  readonly deliver: (fact: ServerFact, signal: AbortSignal) => void | Promise<void>;
}

/**
 * One active plugin's subscription to its process's facts. Every delivery is fire-and-forget:
 * listeners run in parallel, each with a signal aborted at the lifecycle timeout or when the
 * plugin stops, and a failure is logged and contained. `close` refuses further facts, aborts the
 * running listeners and waits for them, bounded, as the call gate does for operations.
 */
export class ServerFactChannel {
  private readonly entries = new Set<ListenerEntry>();
  private readonly stopping = new AbortController();
  private readonly running = new Set<Promise<void>>();
  private link: ChannelLink;
  private closed = false;
  readonly events: ServerPluginEvents;

  constructor(
    private readonly pluginId: string,
    linked: boolean,
    private readonly timeoutMs: number,
    private readonly logger: ServerFactChannelLogger,
  ) {
    this.link = linked ? "live" : "gap";
    this.events = Object.freeze({
      on: <K extends ServerFactKind>(kind: K, listener: ServerFactListener<K>): (() => void) => {
        if (this.closed) return () => undefined;
        const entry: ListenerEntry = { kind, deliver: (fact, signal) => isFactOf(fact, kind) ? listener(fact, signal) : undefined };
        this.entries.add(entry);
        return () => { this.entries.delete(entry); };
      },
    });
  }

  fact(fact: SessionServerFact): void {
    this.step("fact");
    this.deliver(fact);
  }

  linkChanged(state: ServerFactLinkState): void {
    this.step(state);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.entries.clear();
    this.stopping.abort(new DOMException(`Server plugin ${this.pluginId} stopped`, "AbortError"));
    if (this.running.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timed-out">((resolve) => { timer = setTimeout(() => { resolve("timed-out"); }, this.timeoutMs); });
    try {
      const drained = await Promise.race([Promise.allSettled([...this.running]).then((): "settled" => "settled"), timedOut]);
      if (drained === "timed-out") this.logger.warn({ pluginId: this.pluginId }, "server plugin fact listeners did not settle before stop");
    } finally {
      clearTimeout(timer);
    }
  }

  private step(signal: FeedSignal): void {
    const step = LINK_STEPS[this.link][signal];
    this.link = step.next;
    if (step.announceResumed) this.deliver({ kind: "facts.resumed", gap: true });
  }

  private deliver(fact: ServerFact): void {
    if (this.closed) return;
    for (const entry of this.entries) if (entry.kind === fact.kind) this.run(entry, fact);
  }

  private run(entry: ListenerEntry, fact: ServerFact): void {
    const bounded = new AbortController();
    const timer = setTimeout(() => {
      this.logger.warn({ pluginId: this.pluginId, kind: fact.kind, timeoutMs: this.timeoutMs }, "server plugin fact listener timed out");
      bounded.abort(new DOMException(`Server plugin ${this.pluginId} ${fact.kind} listener timed out after ${String(this.timeoutMs)}ms`, "TimeoutError"));
    }, this.timeoutMs);
    timer.unref();
    const signal = AbortSignal.any([this.stopping.signal, bounded.signal]);
    const call = Promise.resolve()
      .then(() => entry.deliver(fact, signal))
      .then(() => undefined, (error: unknown) => {
        if (!this.stopping.signal.aborted) this.logger.warn({ pluginId: this.pluginId, kind: fact.kind, error: errorMessage(error) }, "server plugin fact listener failed");
      })
      .finally(() => {
        clearTimeout(timer);
        if (!bounded.signal.aborted) bounded.abort(new DOMException("Server plugin fact listener settled", "AbortError"));
        this.running.delete(call);
      });
    this.running.add(call);
  }
}

function isFactOf<K extends ServerFactKind>(fact: ServerFact, kind: K): fact is ServerFact<K> {
  return fact.kind === kind;
}
