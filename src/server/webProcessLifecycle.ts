import { clearInterval, setInterval } from "node:timers";
import type {
  FastifyInstance,
  FastifyListenOptions,
} from "fastify";

export const WEB_PROCESS_SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

export type WebProcessShutdownSignal = typeof WEB_PROCESS_SHUTDOWN_SIGNALS[number];
export type WebProcessSignalListener = () => void | Promise<void>;

export interface WebProcessSignalSource {
  subscribe(
    signal: WebProcessShutdownSignal,
    listener: WebProcessSignalListener,
  ): () => void;
}

export interface WebProcessLifecycleDependencies {
  signalSource?: WebProcessSignalSource;
  close?: (app: FastifyInstance) => Promise<void>;
  listen?: (
    app: FastifyInstance,
    options: FastifyListenOptions,
  ) => Promise<unknown>;
  /**
   * Retries owned-resource cleanup directly after Fastify close rejects.
   * Fastify does not rerun a rejected onClose hook on later close calls.
   */
  retryShutdown?: () => Promise<void>;
  /** Delay between referenced retries while owned-resource cleanup is incomplete. */
  shutdownRetryIntervalMs?: number;
}

const DEFAULT_SHUTDOWN_RETRY_INTERVAL_MS = 1_000;

const nodeProcessSignalSource: WebProcessSignalSource = {
  subscribe(signal, listener) {
    const processListener = () => { void listener(); };
    process.on(signal, processListener);
    return () => { process.off(signal, processListener); };
  },
};

const closeWithFastify = (app: FastifyInstance): Promise<void> => app.close();

const listenWithFastify = (
  app: FastifyInstance,
  options: FastifyListenOptions,
): Promise<string> => app.listen(options);

/**
 * Owns web-process signal listeners and the startup failure boundary around a
 * composed Fastify app. Application services remain owned by Fastify hooks;
 * explicitly injected cleanup can retry when a rejected hook cannot be replayed.
 */
export async function runWebProcess(
  app: FastifyInstance,
  listenOptions: FastifyListenOptions,
  dependencies: WebProcessLifecycleDependencies = {},
): Promise<void> {
  const signalSource = dependencies.signalSource ?? nodeProcessSignalSource;
  const close = dependencies.close ?? closeWithFastify;
  const listen = dependencies.listen ?? listenWithFastify;
  const retryShutdown = dependencies.retryShutdown;
  const shutdownRetryIntervalMs = dependencies.shutdownRetryIntervalMs
    ?? DEFAULT_SHUTDOWN_RETRY_INTERVAL_MS;
  const unsubscribeSignals: (() => void)[] = [];
  let resolveShutdownConfirmed: () => void = () => undefined;
  const shutdownConfirmed = new Promise<void>((resolve) => {
    resolveShutdownConfirmed = resolve;
  });
  let fastifyCloseFailed = false;
  let signalsRemoved = false;
  let shutdownInFlight: Promise<void> | undefined;
  let shutdownRetryTimer: NodeJS.Timeout | undefined;

  const removeSignalListeners = (): void => {
    if (signalsRemoved) return;
    signalsRemoved = true;
    for (const unsubscribe of unsubscribeSignals.splice(0)) unsubscribe();
  };
  const releaseShutdownOwnership = (): void => {
    if (shutdownRetryTimer !== undefined) {
      clearInterval(shutdownRetryTimer);
      shutdownRetryTimer = undefined;
    }
    removeSignalListeners();
    resolveShutdownConfirmed();
  };
  function retainShutdownOwnership(): void {
    if (shutdownRetryTimer !== undefined || retryShutdown === undefined) return;
    shutdownRetryTimer = setInterval(() => {
      if (shutdownInFlight !== undefined) return;
      void requestShutdown().catch((error: unknown) => {
        app.log.error(
          { err: error },
          "failed to retry incomplete web server shutdown",
        );
      });
    }, shutdownRetryIntervalMs);
    // Signal listeners and pending Promises do not retain Node's event loop.
    // Keep this retry schedule referenced until exact cleanup is confirmed.
    shutdownRetryTimer.ref();
  }
  function requestShutdown(): Promise<void> {
    if (shutdownInFlight !== undefined) return shutdownInFlight;

    const retryingFailedClose = fastifyCloseFailed && retryShutdown !== undefined;
    const shutdown = Promise.resolve().then(() => (
      retryingFailedClose ? retryShutdown() : close(app)
    ));
    shutdownInFlight = shutdown;
    void shutdown.then(
      () => {
        releaseShutdownOwnership();
      },
      () => {
        if (!retryingFailedClose) fastifyCloseFailed = true;
        if (shutdownInFlight === shutdown) shutdownInFlight = undefined;
        // Without direct retry cleanup, another app.close() cannot replay a
        // rejected Fastify onClose hook and retaining listeners cannot help.
        if (retryShutdown === undefined) removeSignalListeners();
        else retainShutdownOwnership();
      },
    );
    return shutdown;
  }

  app.addHook("onClose", () => {
    // Keep listeners through signal-owned shutdown so concurrent signals join
    // its attempt and a later signal can retry failed owned-resource cleanup.
    // An external close has no lifecycle-owned promise to finalize.
    if (shutdownInFlight === undefined) removeSignalListeners();
    return Promise.resolve();
  });

  for (const signal of WEB_PROCESS_SHUTDOWN_SIGNALS) {
    unsubscribeSignals.push(signalSource.subscribe(signal, async () => {
      try {
        await requestShutdown();
      } catch (error: unknown) {
        app.log.error(
          { err: error, signal },
          "failed to close web server after shutdown signal",
        );
      }
    }));
  }

  try {
    await listen(app, listenOptions);
  } catch (error: unknown) {
    let cleanupError: unknown;
    try {
      await requestShutdown();
    } catch (initialCleanupError: unknown) {
      cleanupError = initialCleanupError;
      if (retryShutdown !== undefined) {
        try {
          await requestShutdown();
          cleanupError = undefined;
        } catch (retryCleanupError: unknown) {
          cleanupError = retryCleanupError;
        }
      }
    }
    if (cleanupError !== undefined) {
      app.log.error(
        { err: cleanupError },
        "web server listen failed and shutdown was incomplete",
      );
      if (retryShutdown !== undefined) {
        // A failed Fastify hook cannot be replayed. Keep the startup boundary
        // and process-signal owner alive until a later direct retry confirms
        // that the exact owned resource was cleaned up.
        await shutdownConfirmed;
      }
    }
    removeSignalListeners();
    throw error;
  }
}
