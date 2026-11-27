import { busReadableBy, type BusRequestAnswer, type BusStateEntry, type ExtensionBusFrame, type ExtensionBusSnapshot } from "../../../shared/extensionBusFrames";
import type { PluginBusState, PluginSessionBus } from "../../../shared/pluginApiTypes";

/** The session a bus belongs to. */
export interface SessionBusScope {
  readonly machineId: string;
  readonly sessionId: string;
  readonly cwd: string;
}

export interface SessionBusHostDependencies {
  /** The session on screen now, or none. */
  current(): SessionBusScope | undefined;
  /**
   * The bus's retained states; undefined when the session's runtime is not open or its machine
   * carries no bus. Rejects when the machine did not answer: that is no answer, and nothing held is
   * changed by it.
   */
  read(scope: SessionBusScope): Promise<ExtensionBusSnapshot | undefined>;
  ask(scope: SessionBusScope, channel: string, input: unknown, pluginId: string): Promise<BusRequestAnswer>;
  /** A state a page may be drawing changed. */
  changed(): void;
}

interface Listener {
  readonly pluginId: string;
  readonly channel: string;
  readonly state?: (state: PluginBusState) => void;
  readonly event?: (value: unknown, dropped: number) => void;
}

const UNKNOWN: PluginBusState = Object.freeze({ known: false });
const READ_RETRY_MS = 5_000;

function keyOf(scope: SessionBusScope | undefined): string | undefined {
  return scope === undefined ? undefined : JSON.stringify([scope.machineId, scope.sessionId]);
}

/** What a request rejects with: `code` is the daemon's, or `session-changed` when another session is on screen. */
export class SessionBusRequestError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SessionBusRequestError";
  }
}

/**
 * The extension bus of the session on screen, for the page's plugins (docs/design/extension-bus.md,
 * "The page side").
 *
 * It holds one session's states at a time, the one on screen, with the scope they were read for: a
 * handle made for another session reads unknown, hears nothing and may not ask. States arrive as a
 * snapshot and then as numbered frames; a frame that does not follow the last one means frames were
 * missed, and the snapshot is read again instead of applying it on top of a hole.
 */
export class SessionBusHost {
  private key: string | undefined;
  private epoch: string | undefined;
  private revision = 0;
  private states = new Map<string, BusStateEntry>();
  private listeners = new Set<Listener>();
  /** One read at a time: `again` says something arrived that the read in flight may not show. */
  private reading: { again: boolean } | undefined;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: SessionBusHostDependencies) {}

  /** A bus frame from a session's stream. */
  frame(machineId: string, sessionId: string, frame: ExtensionBusFrame): void {
    const scope = this.follow();
    if (scope?.machineId !== machineId || scope.sessionId !== sessionId) return;
    if (frame.kind === "event") { this.tell(frame.channel, frame, (listener) => { listener.event?.(frame.value, frame.dropped ?? 0); }); return; }
    if (frame.kind === "reset" || this.reading !== undefined || this.epoch !== frame.epoch || frame.revision !== this.revision + 1) { this.read(scope); return; }
    this.revision = frame.revision;
    if ("value" in frame) this.states.set(frame.channel, { channel: frame.channel, value: frame.value, ...(frame.plugins === undefined ? {} : { plugins: frame.plugins }) });
    else this.states.delete(frame.channel);
    this.tellState(frame.channel, frame);
  }

  /** The page stopped hearing the session's stream: what it holds may be behind, so it is read again. */
  streamLost(machineId: string, sessionId: string): void {
    const scope = this.follow();
    if (scope?.machineId === machineId && scope.sessionId === sessionId) this.read(scope);
  }

  /** The bus of one session for one plugin; it answers only while that session is the one on screen. */
  handle(scope: SessionBusScope, pluginId: string): PluginSessionBus {
    const key = keyOf(scope);
    this.follow();
    const onScreen = (): boolean => keyOf(this.follow()) === key;
    const listen = (channel: string, calls: Pick<Listener, "state" | "event">): (() => void) => {
      if (!onScreen()) return () => undefined;
      const listener: Listener = { pluginId, channel, ...calls };
      this.listeners.add(listener);
      return () => { this.listeners.delete(listener); };
    };
    return {
      state: (channel) => (onScreen() ? this.stateOf(channel, pluginId) : UNKNOWN),
      onState: (channel, listener) => listen(channel, { state: listener }),
      on: (channel, listener) => listen(channel, { event: listener }),
      request: async (channel, input) => {
        if (!onScreen()) throw new SessionBusRequestError("session-changed", "Another session is on screen now.");
        const answer = await this.deps.ask(scope, channel, input, pluginId).catch((error: unknown) => {
          throw new SessionBusRequestError("unreachable", error instanceof Error ? error.message : "The session's machine did not answer.");
        });
        if ("error" in answer) throw new SessionBusRequestError(answer.error.code, answer.error.message);
        return answer.result;
      },
    };
  }

  /** The session on screen, after dropping what was held for another one. */
  private follow(): SessionBusScope | undefined {
    const scope = this.deps.current();
    const key = keyOf(scope);
    if (key === this.key) return scope;
    this.key = key;
    this.epoch = undefined;
    this.revision = 0;
    this.states = new Map();
    this.listeners = new Set();
    this.reading = undefined;
    clearTimeout(this.retry);
    if (scope !== undefined) this.read(scope);
    return scope;
  }

  private read(scope: SessionBusScope): void {
    if (this.reading !== undefined) { this.reading.again = true; return; }
    const reading = { again: false };
    this.reading = reading;
    clearTimeout(this.retry);
    const key = keyOf(scope);
    const settled = (): boolean => {
      if (this.reading !== reading || key !== this.key) return false;
      this.reading = undefined;
      return true;
    };
    void this.deps.read(scope).then((snapshot) => {
      if (!settled()) return;
      this.hold(snapshot);
      if (reading.again) this.read(scope);
    }, () => {
      if (settled()) this.retry = setTimeout(() => { if (key === this.key) this.read(scope); }, READ_RETRY_MS);
    });
  }

  private hold(snapshot: ExtensionBusSnapshot | undefined): void {
    const before = this.states;
    this.epoch = snapshot?.epoch;
    this.revision = snapshot?.revision ?? 0;
    this.states = new Map((snapshot?.states ?? []).map((entry) => [entry.channel, entry]));
    for (const channel of new Set([...before.keys(), ...this.states.keys()])) {
      const entry = this.states.get(channel) ?? before.get(channel);
      if (entry !== undefined && JSON.stringify(before.get(channel)?.value) !== JSON.stringify(this.states.get(channel)?.value)) this.tellState(channel, entry);
    }
  }

  /** A channel's value for a plugin, or unknown; `pluginId` undefined reads it for whoever may. */
  private stateOf(channel: string, pluginId: string | undefined): PluginBusState {
    const entry = this.states.get(channel);
    if (entry === undefined || (pluginId !== undefined && !busReadableBy(entry, pluginId))) return UNKNOWN;
    return { known: true, value: entry.value };
  }

  private tellState(channel: string, address: { readonly plugins?: readonly string[] | undefined }): void {
    const state = this.stateOf(channel, undefined);
    this.tell(channel, address, (listener) => { listener.state?.(state); });
    this.deps.changed();
  }

  private tell(channel: string, address: { readonly plugins?: readonly string[] | undefined }, call: (listener: Listener) => void): void {
    for (const listener of [...this.listeners]) {
      if (listener.channel !== channel || !busReadableBy(address, listener.pluginId)) continue;
      try {
        call(listener);
      } catch (error) {
        console.error(`[plugin] ${listener.pluginId} threw in its ${channel} listener`, error);
      }
    }
  }
}
