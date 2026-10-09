/**
 * The door every call into one active server plugin passes through (B19).
 *
 * A live disable has to keep three promises a restart kept for free: no new operation or route
 * handler starts once the plugin is being turned off, the calls already running are told to stop,
 * and `stop` runs only after they settled. The gate owns that order. While open it counts each
 * call and hands it the plugin's own signal beside the caller's; `close` shuts the door, aborts
 * that signal, and waits for the count to reach zero, bounded so a handler that ignores its signal
 * cannot hold the disable forever.
 */
export type InactivePluginState = "stopping" | "disabled" | "failed" | "incompatible";

/** A call reached a plugin that is not running; the host answers it 409 with this code. */
export class PluginNotActiveError extends Error {
  override name = "PluginNotActiveError";
  readonly code = "plugin-not-active";

  constructor(readonly pluginId: string, readonly state: InactivePluginState) {
    super(`The PI WEB plugin ${pluginId} is not running (${state})`);
  }
}

export type GateCloseOutcome = "settled" | "timed-out";

export class PluginCallGate {
  private readonly controller = new AbortController();
  private open = true;
  private running = 0;
  private settled: (() => void) | undefined;

  constructor(private readonly pluginId: string) {}

  /** Run one call through the gate: refused once closed, given a signal that also fires on close. */
  async run<T>(callerSignal: AbortSignal, call: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (!this.open) throw new PluginNotActiveError(this.pluginId, "stopping");
    this.running += 1;
    try {
      return await call(AbortSignal.any([callerSignal, this.controller.signal]));
    } finally {
      this.running -= 1;
      if (this.running === 0) this.settled?.();
    }
  }

  /** Refuse new calls, abort the running ones, and wait for them to settle within `timeoutMs`. */
  async close(timeoutMs: number): Promise<GateCloseOutcome> {
    this.open = false;
    this.controller.abort(new PluginNotActiveError(this.pluginId, "stopping"));
    if (this.running === 0) return "settled";
    const drained = new Promise<GateCloseOutcome>((resolve) => { this.settled = () => { resolve("settled"); }; });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<GateCloseOutcome>((resolve) => { timer = setTimeout(() => { resolve("timed-out"); }, timeoutMs); });
    try {
      return await Promise.race([drained, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
