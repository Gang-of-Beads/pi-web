import { createEventBus, type EventBus } from "@earendil-works/pi-coding-agent";
import { parseDeclaredStates, SESSION_STATES_CHANNEL_PREFIX, type DeclaredSessionState } from "../../../shared/declaredSessionStates.js";
import type { BusChannelDeclaration } from "../../../shared/extensionBusChannels.js";

const MAX_VALUE_LENGTH = 64 * 1024;

/** A value as the JSON that would be carried, or undefined when it has none (a cycle, a function, undefined). */
function jsonOf(data: unknown): string | undefined {
  try {
    const json: unknown = JSON.stringify(data);
    return typeof json === "string" ? json : undefined;
  } catch {
    return undefined;
  }
}

/**
 * One session's `pi.events`, owned by the daemon so that what extensions publish can leave the
 * session (docs/design/extension-bus.md).
 *
 * The extensions get an ordinary pi event bus: `emit` reaches every listener exactly as in the
 * terminal. The daemon looks at each emit afterwards and keeps the last value of the channels a loaded
 * extension declared as `state`. Nothing is kept for a channel nobody declared, and a handler of the
 * daemon's never throws into an extension's emit.
 */
export class SessionExtensionBus {
  private readonly inner = createEventBus();
  private declared: ReadonlyMap<string, BusChannelDeclaration> = new Map();
  /** The last value of each declared state channel, as the JSON that would be carried. */
  private readonly retained = new Map<string, string>();
  private readonly refused = new Set<string>();
  private changed: (() => void) | undefined;
  private warn: ((message: string) => void) | undefined;

  /** The bus handed to pi's resource loader for this session. */
  readonly bus: EventBus = {
    emit: (channel, data) => {
      this.inner.emit(channel, data);
      this.observe(channel, data);
    },
    on: (channel, handler) => this.inner.on(channel, handler),
  };

  /** Called when a retained value changed, and with a sentence when something published could not be carried. */
  watch(changed: () => void, warn: (message: string) => void): void {
    this.changed = changed;
    this.warn = warn;
  }

  /** The channels this session's loaded extensions declared; a value of a channel no longer declared is dropped. */
  declare(channels: ReadonlyMap<string, BusChannelDeclaration>): void {
    this.declared = channels;
    this.drop([...this.retained.keys()].filter((channel) => !channels.has(channel)));
  }

  /** Every value is forgotten: the extensions are being loaded again, and what the last instances said is not what the new ones say. */
  forget(): void {
    this.drop([...this.retained.keys()]);
  }

  private drop(channels: readonly string[]): void {
    for (const channel of channels) this.retained.delete(channel);
    if (channels.length > 0) this.changed?.();
  }

  /** The session states the extensions declare now, in channel order; empty when none has published. */
  declaredStates(): DeclaredSessionState[] {
    return [...this.retained.entries()]
      .filter(([channel]) => channel.startsWith(SESSION_STATES_CHANNEL_PREFIX))
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([channel, json]) => parseDeclaredStates(channel.slice(SESSION_STATES_CHANNEL_PREFIX.length), JSON.parse(json)) ?? []);
  }

  private observe(channel: string, data: unknown): void {
    if (this.declared.get(channel)?.kind !== "state") return;
    const json = jsonOf(data);
    if (json === undefined) { this.refuse(channel, "is not JSON"); return; }
    if (json.length > MAX_VALUE_LENGTH) { this.refuse(channel, "is larger than 64 KiB"); return; }
    if (this.retained.get(channel) === json) return;
    if (channel.startsWith(SESSION_STATES_CHANNEL_PREFIX) && parseDeclaredStates(channel.slice(SESSION_STATES_CHANNEL_PREFIX.length), JSON.parse(json)) === undefined) {
      this.refuse(channel, "is not a list of { id, label, tone, busy, count? }");
      return;
    }
    this.retained.set(channel, json);
    this.changed?.();
  }

  /** Said once per channel: an extension that publishes wrongly does so on every change. */
  private refuse(channel: string, why: string): void {
    if (this.refused.has(channel)) return;
    this.refused.add(channel);
    this.warn?.(`What an extension published on ${channel} ${why}, so it is not shown.`);
  }
}
