import { describe, expect, it, vi } from "vitest";
import { runSessionDaemonShutdown } from "./sessionDaemonShutdown.js";

describe("session daemon shutdown", () => {
  it("quiesces ingress, disposes consumers before providers, waits for credential writes, and continues after failures", async () => {
    const events: string[] = [];
    const failure = new Error("plugin stop failed");
    const logger = { error: vi.fn() };
    const onFailure = vi.fn();
    let settleWrites = (): void => undefined;
    let writingStarted = (): void => undefined;
    const pendingWrites = new Promise<void>((resolve) => { settleWrites = resolve; });
    const writesStarted = new Promise<void>((resolve) => { writingStarted = resolve; });

    const shutdown = runSessionDaemonShutdown({
      logger,
      onFailure,
      dependencies: {
        quiesceServer: () => { events.push("quiesce"); },
        serverPlugins: { stop: () => { events.push("plugins"); throw failure; } },
        terminals: { dispose: () => { events.push("terminals"); } },
        catalogRefresher: { dispose: () => { events.push("catalog"); } },
        auth: { dispose: () => { events.push("auth"); } },
        settleCredentialWrites: () => { events.push("credentials"); writingStarted(); return pendingWrites; },
        sessions: { dispose: () => { events.push("sessions"); } },
        serverFacts: { deliverPending: () => { events.push("facts"); } },
        unreadStore: { flush: () => { events.push("unread"); } },
        closeServer: () => { events.push("server"); },
      },
    });

    await writesStarted;
    expect(events).toEqual(["quiesce", "terminals", "catalog", "sessions", "facts", "server", "plugins", "auth", "credentials"]);
    settleWrites();
    await shutdown;
    expect(events).toEqual(["quiesce", "terminals", "catalog", "sessions", "facts", "server", "plugins", "auth", "credentials", "unread"]);
    expect(onFailure).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith(
      { err: failure, operation: "stop server plugins" },
      "session daemon shutdown operation failed",
    );
  });
});
