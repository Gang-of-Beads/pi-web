import type { SessionScope } from "../../../server-plugin-api.js";
import type { ServerFactFeed, ServerFactFeedSubscriber, SessionServerFact } from "../../shared/plugins/serverFactChannel.js";
import type { WorkspaceAttribution } from "../status/workspaceAttribution.js";

export interface DaemonServerFactLogger {
  warn(details: Record<string, unknown>, message: string): void;
}

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

  private async attributed(session: SessionScope): Promise<SessionScope> {
    const owners = await this.attribution()?.attribute([session.cwd]).catch((error: unknown) => {
      this.logger.warn({ err: error, cwd: session.cwd }, "a server fact could not be attributed to a workspace");
      return undefined;
    });
    const owner = owners?.get(session.cwd);
    return owner === undefined ? session : { ...session, projectId: owner.projectId, workspaceId: owner.workspaceId };
  }
}
