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
}

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
 * composed Fastify app. Application services remain owned by Fastify hooks, so
 * every shutdown path converges on one app.close() operation.
 */
export async function runWebProcess(
  app: FastifyInstance,
  listenOptions: FastifyListenOptions,
  dependencies: WebProcessLifecycleDependencies = {},
): Promise<void> {
  const signalSource = dependencies.signalSource ?? nodeProcessSignalSource;
  const close = dependencies.close ?? closeWithFastify;
  const listen = dependencies.listen ?? listenWithFastify;
  const unsubscribeSignals: (() => void)[] = [];
  let signalsRemoved = false;
  let closePromise: Promise<void> | undefined;

  const removeSignalListeners = (): void => {
    if (signalsRemoved) return;
    signalsRemoved = true;
    for (const unsubscribe of unsubscribeSignals.splice(0)) unsubscribe();
  };
  const closeOnce = (): Promise<void> => {
    closePromise ??= Promise.resolve()
      .then(() => close(app))
      .finally(removeSignalListeners);
    return closePromise;
  };

  app.addHook("onClose", () => {
    // Keep listeners through signal-owned shutdown so later signals join the
    // same close promise. An external close has no such promise to finalize.
    if (closePromise === undefined) removeSignalListeners();
    return Promise.resolve();
  });

  for (const signal of WEB_PROCESS_SHUTDOWN_SIGNALS) {
    unsubscribeSignals.push(signalSource.subscribe(signal, async () => {
      try {
        await closeOnce();
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
    try {
      await closeOnce();
    } catch (cleanupError: unknown) {
      app.log.error(
        { err: cleanupError },
        "web server listen failed and shutdown was incomplete",
      );
    }
    throw error;
  }
}
