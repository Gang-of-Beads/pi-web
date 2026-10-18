import type { SessionScope } from "../../../server-plugin-api.js";
import type { ServerFactFeed, ServerFactFeedSubscriber, SessionServerFact } from "../../shared/plugins/serverFactChannel.js";
import type { WorkspaceAttribution } from "../status/workspaceAttribution.js";

export interface DaemonServerFactLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

/**
 * How long shutdown waits for the facts already reported to reach their subscribers. A cold
 * workspace attribution (the topology cache expired) is cut at this bound and the fact goes on
 * with its unattributed scope: a run.ended without a project beats no run.ended at all.
 */
const SHUTDOWN_DELIVERY_BOUND_MS = 2_000;

/** Where the session service reports a fact it decided; the session never waits on it. */
export interface ServerFactReporter {
  report(fact: SessionServerFact): void;
}

/**
 * The daemon's facts, as its own plugins and the web process's relay hear them. The session
 * service reports each fact once, where it decides it; this feed adds the project and workspace
 * the session's directory belongs to and hands it on, one fact at a time so listeners hear them
 * in the order they were decided. It is always linked: the daemon is where the facts are made.
 */
export class DaemonServerFactFeed implements ServerFactFeed, ServerFactReporter {
  private readonly subscribers = new Set<ServerFactFeedSubscriber>();
  private tail: Promise<void> = Promise.resolve();
  private readonly attributionCut = new AbortController();

  constructor(
    private readonly attribution: () => WorkspaceAttribution | undefined,
    private readonly logger: DaemonServerFactLogger,
  ) {}

  linked(): boolean {
    return true;
  }

  subscribe(subscriber: ServerFactFeedSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => { this.subscribers.delete(subscriber); };
  }

  report(fact: SessionServerFact): void {
    this.tail = this.tail
      .then(async () => {
        const attributed = { ...fact, session: await this.attributed(fact.session) };
        for (const subscriber of this.subscribers) subscriber.fact(attributed);
      })
      .catch((error: unknown) => { this.logger.warn({ err: error, kind: fact.kind }, "a server fact could not be delivered"); });
  }

  /**
   * Deliver every fact already reported before shutdown closes the relay route and stops the
   * plugins. Bounded: an attribution still loading at the bound is abandoned, its fact goes on
   * unattributed.
   */
  async deliverPending(): Promise<void> {
    const timer = setTimeout(() => {
      this.logger.warn({ boundMs: SHUTDOWN_DELIVERY_BOUND_MS }, "server facts still being attributed at shutdown go on unattributed");
      this.attributionCut.abort();
    }, SHUTDOWN_DELIVERY_BOUND_MS);
    try {
      await this.tail;
    } finally {
      clearTimeout(timer);
    }
  }

  private async attributed(session: SessionScope): Promise<SessionScope> {
    const attributing = this.attribution()?.attribute([session.cwd]).catch((error: unknown) => {
      this.logger.warn({ err: error, cwd: session.cwd }, "a server fact could not be attributed to a workspace");
      return undefined;
    });
    const owners = attributing === undefined ? undefined : await untilCut(attributing, this.attributionCut.signal);
    const owner = owners?.get(session.cwd);
    return owner === undefined ? session : { ...session, projectId: owner.projectId, workspaceId: owner.workspaceId };
  }
}

/** The work's answer, or `undefined` once the cut comes first; nothing stays registered on the signal. */
function untilCut<T>(work: Promise<T>, cut: AbortSignal): Promise<T | undefined> {
  if (cut.aborted) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    const onCut = (): void => { resolve(undefined); };
    cut.addEventListener("abort", onCut, { once: true });
    void work.then((answer) => {
      cut.removeEventListener("abort", onCut);
      resolve(answer);
    });
  });
}
