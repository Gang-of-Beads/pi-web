import { AsyncLocalStorage } from "node:async_hooks";
import type { ExtensionNoticeLevel } from "../../../shared/apiTypes.js";

/** A line a command's handler showed the reader while it ran. */
export interface CommandNotice {
  level: ExtensionNoticeLevel;
  message: string;
}

/**
 * Where a command's answer collects: the session the handler runs in, and the notices it showed
 * the reader there, oldest first.
 */
export interface CommandAnswer {
  readonly sessionId: string;
  readonly notices: CommandNotice[];
}

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
 * The same context says which command a notice belongs to, so the command's
 * answer (`command.settled`) can carry what its handler told the reader
 * (design B3/S3 v2, 4.2).
 *
 * The scope is live only until the handler returns. A run the command starts
 * (`sendUserMessage`) inherits the context, and its own dialogs and notices are
 * the run's again once the command is done.
 */
export class CommandHandlerScope {
  private readonly storage = new AsyncLocalStorage<{ live: boolean; answer: CommandAnswer | undefined }>();

  async run<T>(handler: () => Promise<T>, answer?: CommandAnswer): Promise<T> {
    const scope = { live: true, answer };
    try {
      return await this.storage.run(scope, handler);
    } finally {
      scope.live = false;
    }
  }

  get inHandler(): boolean {
    return this.storage.getStore()?.live === true;
  }

  /** A notice shown in `sessionId` now: part of the answer of the command whose handler is running, if one is. */
  heard(sessionId: string, notice: CommandNotice): void {
    const scope = this.storage.getStore();
    if (scope?.live === true && scope.answer?.sessionId === sessionId) scope.answer.notices.push(notice);
  }
}
