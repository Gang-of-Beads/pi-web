import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Whether the code running now was called by an extension command's handler.
 *
 * A dialog opened during a run is settled when that run ends or is stopped:
 * Stop must not leave the agent loop parked behind a tool's question. A
 * command typed while a run is going runs its handler beside the run, not in
 * it, so the dialog it opens belongs to the command and outlives the run.
 * Deciding by `session.isStreaming` alone closed such a dialog when the
 * unrelated run ended, before the reader could answer it (B54, found
 * 2026-10-02: the command's `ctx.ui.custom` returned undefined within a
 * second). The async context the dialog opens in tells the two apart: a tool
 * or an event handler of the run never runs inside the command's handler.
 *
 * The scope is live only until the handler returns. A run the command starts
 * (`sendUserMessage`) inherits the context, and its own dialogs are the run's
 * again once the command is done.
 */
export class CommandHandlerScope {
  private readonly storage = new AsyncLocalStorage<{ live: boolean }>();

  async run<T>(handler: () => Promise<T>): Promise<T> {
    const scope = { live: true };
    try {
      return await this.storage.run(scope, handler);
    } finally {
      scope.live = false;
    }
  }

  get inHandler(): boolean {
    return this.storage.getStore()?.live === true;
  }
}
