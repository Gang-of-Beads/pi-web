export interface SessionDaemonShutdownLogger {
  error(details: Record<string, unknown>, message: string): void;
}

export interface SessionDaemonShutdownDependencies {
  quiesceServer(): void | Promise<void>;
  serverPlugins: { stop(): void | Promise<void> };
  terminals: { dispose(): void | Promise<void> };
  catalogRefresher: { dispose(): void | Promise<void> };
  auth: { dispose(): void | Promise<void> };
  sessions: { dispose(): void | Promise<void> };
  /**
   * Wait for in-flight agent runs, after ingress is quiesced and before the
   * sessions are disposed. Optional so existing callers and tests keep their
   * behaviour; omitted means tear down immediately, as before.
   */
  drainActiveWork?: () => void | Promise<void>;
  unreadStore: { flush(): void | Promise<void> };
  closeServer(): void | Promise<void>;
}

export interface SessionDaemonShutdownOptions {
  logger: SessionDaemonShutdownLogger;
  dependencies: SessionDaemonShutdownDependencies;
  onFailure?: () => void;
}

/** Quiesces ingress, disposes consumers, then tears down plugin providers and dependencies. */
export async function runSessionDaemonShutdown(options: SessionDaemonShutdownOptions): Promise<void> {
  const { dependencies } = options;
  const operations: readonly (readonly [string, () => void | Promise<void>])[] = [
    ["quiesce server", () => dependencies.quiesceServer()],
    // Between quiescing and disposal: no new work can arrive, and the runs
    // already underway get a bounded chance to finish. An agent turn cannot be
    // resumed after the process exits, so not interrupting it is the only way a
    // restart is non-disruptive.
    ...(dependencies.drainActiveWork === undefined
      ? []
      : [["drain active work", () => dependencies.drainActiveWork?.()] as const]),
    ["dispose terminals", () => dependencies.terminals.dispose()],
    ["dispose catalog refresher", () => dependencies.catalogRefresher.dispose()],
    ["dispose sessions", () => dependencies.sessions.dispose()],
    ["close server", () => dependencies.closeServer()],
    ["stop server plugins", () => dependencies.serverPlugins.stop()],
    ["dispose auth", () => dependencies.auth.dispose()],
    ["flush session unread state", () => dependencies.unreadStore.flush()],
  ];

  for (const [operation, run] of operations) {
    try {
      await run();
    } catch (error) {
      options.onFailure?.();
      options.logger.error({ err: error, operation }, "session daemon shutdown operation failed");
    }
  }
}
