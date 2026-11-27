import { randomUUID } from "node:crypto";
import { createEventBus, type EventBus } from "@earendil-works/pi-coding-agent";
import { parseDeclaredStates, SESSION_STATES_CHANNEL_PREFIX, type DeclaredSessionState } from "../../../shared/declaredSessionStates.js";
import type { BusRequestAnswer, BusRequestErrorCode, ExtensionBusFrame, ExtensionBusSnapshot } from "../../../shared/extensionBusFrames.js";
import { isRecord } from "../../../shared/unknownValues.js";
import type { DeclaredBusChannel } from "./busDeclarations.js";

const MAX_VALUE_BYTES = 64 * 1024;
/** A state channel carries at most four frames a second, the latest value last: a value can be 64 KiB and the stream keeps 256 frames to replay. */
const STATE_FRAME_INTERVAL_MS = 250;
const MAX_EVENTS_PER_SECOND = 20;
/** Under the 25 s the web process gives the daemon to answer, so the page hears this reason and not the proxy's. */
const REQUEST_TIMEOUT_MS = 20_000;

type Carried = { readonly json: string } | { readonly refusal: "not-json" | "too-large" };

const REFUSAL_WORDS: Readonly<Record<"not-json" | "too-large", string>> = { "not-json": "is not JSON", "too-large": "is larger than 64 KiB" };

/** A value as the JSON that would be carried, or why it cannot be (a cycle, a function, undefined; over the limit). */
function carried(data: unknown): Carried {
  let json: unknown;
  try {
    json = JSON.stringify(data);
  } catch {
    return { refusal: "not-json" };
  }
  if (typeof json !== "string") return { refusal: "not-json" };
  return Buffer.byteLength(json) > MAX_VALUE_BYTES ? { refusal: "too-large" } : { json };
}

/** A carried value read back: what a listener or a page gets is the JSON, never the extension's own object. */
function parsed(json: string): unknown {
  const value: unknown = JSON.parse(json);
  return value;
}

/** What an extension said went wrong: its words, or its error's. */
function errorWords(error: unknown): string {
  if (typeof error === "string" && error !== "") return error;
  const message = isRecord(error) ? error["message"] : error instanceof Error ? error.message : undefined;
  return typeof message === "string" && message !== "" ? message : "The extension answered with an error.";
}

function refusedAnswer(code: BusRequestErrorCode, message: string): BusRequestAnswer {
  return { error: { code, message } };
}

/** Who may read a channel: its package's own plugins, or anyone. */
function addressOf(declaration: DeclaredBusChannel): { channel: string; plugins?: readonly string[] } {
  return { channel: declaration.channel, ...(declaration.access === "public" ? {} : { plugins: declaration.ownPlugins }) };
}

function isSessionStates(channel: string): boolean {
  return channel.startsWith(SESSION_STATES_CHANNEL_PREFIX);
}

export interface SessionExtensionBusOptions {
  readonly now?: () => number;
  readonly requestTimeoutMs?: number;
}

/**
 * One session's `pi.events`, owned by the daemon so that what extensions publish can leave the
 * session (docs/design/extension-bus.md).
 *
 * The extensions get an ordinary pi event bus: `emit` reaches every listener exactly as in the
 * terminal. The daemon looks at each emit afterwards: it keeps the last value of the channels a
 * loaded extension declared as `state`, hands on the ones declared `event`, and asks on the ones
 * declared `request`. Nothing is kept or carried for a channel nobody declared, and a handler of the
 * daemon's never throws into an extension's emit.
 */
export class SessionExtensionBus {
  private readonly inner = createEventBus();
  private declared: ReadonlyMap<string, DeclaredBusChannel> = new Map();
  /** The last value of each declared state channel, as the JSON that would be carried. */
  private readonly retained = new Map<string, string>();
  private readonly refused = new Set<string>();
  /** Names the bus a revision counts in: a daemon that starts again counts from nothing. */
  private readonly epoch = randomUUID();
  /** Counts the changes to the states a page reads; the session states travel with the status instead. */
  private revision = 0;
  private readonly eventWindows = new Map<string, { startedAt: number; carried: number; dropped: number }>();
  /** When each state channel last carried a frame, and the timer of a value waiting its turn. */
  private readonly stateFrames = new Map<string, { carriedAt: number; waiting?: ReturnType<typeof setTimeout> }>();
  private readonly now: () => number;
  private readonly requestTimeoutMs: number;
  private changed: (() => void) | undefined;
  private warn: ((message: string) => void) | undefined;
  private carry: ((frame: ExtensionBusFrame) => void) | undefined;

  constructor(options: SessionExtensionBusOptions = {}) {
    this.now = options.now ?? Date.now;
    this.requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  }

  /** The bus handed to pi's resource loader for this session. */
  readonly bus: EventBus = {
    emit: (channel, data) => {
      this.inner.emit(channel, data);
      try {
        this.observe(channel, data);
      } catch (error) {
        this.warn?.(`What an extension published on ${channel} could not be carried: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    on: (channel, handler) => this.inner.on(channel, handler),
  };

  /**
   * `changed`: the session states changed. `warn`: a sentence, when something published could not be
   * carried. `carry`: a frame for the pages showing the session.
   */
  watch(changed: () => void, warn: (message: string) => void, carry?: (frame: ExtensionBusFrame) => void): void {
    this.changed = changed;
    this.warn = warn;
    this.carry = carry;
    carry?.({ kind: "reset" });
  }

  /** The channels this session's loaded extensions declared; a value of a channel no longer declared is dropped. */
  declare(channels: ReadonlyMap<string, DeclaredBusChannel>): void {
    const before = this.declared;
    this.declared = channels;
    this.drop([...this.retained.keys()].filter((channel) => !channels.has(channel)), before);
  }

  /** Every value is forgotten: the extensions are being loaded again, and what the last instances said is not what the new ones say. */
  forget(): void {
    this.drop([...this.retained.keys()], this.declared);
  }

  private drop(channels: readonly string[], declaredWhenKept: ReadonlyMap<string, DeclaredBusChannel>): void {
    for (const channel of channels) {
      this.retained.delete(channel);
      const declaration = declaredWhenKept.get(channel);
      if (isSessionStates(channel) || declaration === undefined) continue;
      clearTimeout(this.stateFrames.get(channel)?.waiting);
      this.stateFrames.delete(channel);
      this.revision += 1;
      this.carry?.({ kind: "state", ...addressOf(declaration), epoch: this.epoch, revision: this.revision });
    }
    if (channels.some(isSessionStates)) this.changed?.();
  }

  /** The session states the extensions declare now, in channel order; empty when none has published. */
  declaredStates(): DeclaredSessionState[] {
    return [...this.retained.entries()]
      .filter(([channel]) => isSessionStates(channel))
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([channel, json]) => parseDeclaredStates(channel.slice(SESSION_STATES_CHANNEL_PREFIX.length), JSON.parse(json)) ?? []);
  }

  /** Every state a page reads, with the revision it is current through. */
  snapshot(): ExtensionBusSnapshot {
    const states = [...this.retained.entries()].flatMap(([channel, json]) => {
      const declaration = this.declared.get(channel);
      return isSessionStates(channel) || declaration === undefined ? [] : [{ ...addressOf(declaration), value: parsed(json) }];
    });
    return { epoch: this.epoch, revision: this.revision, states };
  }

  /**
   * Ask an extension: `{ id, input }` goes out on `<channel>:request` and the first `{ id, result }`
   * or `{ id, error }` on `<channel>:response` with that id is the answer, as pi-subagents does it.
   */
  request(channel: string, input: unknown, pluginId: string): Promise<BusRequestAnswer> {
    const declaration = this.declared.get(channel);
    if (declaration?.kind !== "request") return Promise.resolve(refusedAnswer("not-declared", `No loaded extension declares ${channel} as a request channel.`));
    if (declaration.access !== "public" && !declaration.ownPlugins.includes(pluginId)) return Promise.resolve(refusedAnswer("not-allowed", `${channel} is for its own package's plugins.`));
    const sent = carried(input ?? null);
    if ("refusal" in sent) return Promise.resolve(refusedAnswer(sent.refusal, `What was asked on ${channel} ${REFUSAL_WORDS[sent.refusal]}.`));
    const id = randomUUID();
    return new Promise((resolve) => {
      const settle = (answer: BusRequestAnswer): void => {
        clearTimeout(timer);
        stopListening();
        resolve(answer);
      };
      const timer = setTimeout(() => { settle(refusedAnswer("timeout", `The extension did not answer ${channel} in ${String(this.requestTimeoutMs / 1000)} seconds.`)); }, this.requestTimeoutMs);
      const stopListening = this.inner.on(`${channel}:response`, (data) => {
        if (!isRecord(data) || data["id"] !== id) return;
        if ("error" in data) { settle(refusedAnswer("extension-error", errorWords(data["error"]))); return; }
        const answered = carried(data["result"] ?? null);
        settle("refusal" in answered ? refusedAnswer(answered.refusal, `What the extension answered on ${channel} ${REFUSAL_WORDS[answered.refusal]}.`) : { result: parsed(answered.json) });
      });
      this.inner.emit(`${channel}:request`, { id, input: parsed(sent.json) });
    });
  }

  private observe(channel: string, data: unknown): void {
    const declaration = this.declared.get(channel);
    if (declaration === undefined || declaration.kind === "request") return;
    const value = carried(data);
    if ("refusal" in value) { this.refuse(channel, REFUSAL_WORDS[value.refusal]); return; }
    if (declaration.kind === "event") { this.carryEvent(declaration, value.json); return; }
    if (this.retained.get(channel) === value.json) return;
    if (isSessionStates(channel)) {
      if (parseDeclaredStates(channel.slice(SESSION_STATES_CHANNEL_PREFIX.length), JSON.parse(value.json)) === undefined) {
        this.refuse(channel, "is not a list of { id, label, tone, busy, count? }");
        return;
      }
      this.retained.set(channel, value.json);
      this.changed?.();
      return;
    }
    this.retained.set(channel, value.json);
    this.carryStateInTurn(channel);
  }

  /** Carry a state channel's value now, or once its quarter second is over; a value replaced while waiting is never carried. */
  private carryStateInTurn(channel: string): void {
    const frames = this.stateFrames.get(channel);
    if (frames?.waiting !== undefined) return;
    const wait = frames === undefined ? 0 : frames.carriedAt + STATE_FRAME_INTERVAL_MS - this.now();
    if (wait <= 0) { this.carryState(channel); return; }
    const waiting = setTimeout(() => { this.carryState(channel); }, wait);
    waiting.unref();
    this.stateFrames.set(channel, { carriedAt: frames?.carriedAt ?? 0, waiting });
  }

  private carryState(channel: string): void {
    const declaration = this.declared.get(channel);
    const json = this.retained.get(channel);
    this.stateFrames.set(channel, { carriedAt: this.now() });
    if (declaration === undefined || json === undefined) return;
    this.revision += 1;
    this.carry?.({ kind: "state", ...addressOf(declaration), epoch: this.epoch, revision: this.revision, value: parsed(json) });
  }

  /** At most twenty a second a channel; the next one carried says how many were not. */
  private carryEvent(declaration: DeclaredBusChannel, json: string): void {
    const now = this.now();
    const current = this.eventWindows.get(declaration.channel);
    const window = current === undefined || now - current.startedAt >= 1000 ? { startedAt: now, carried: 0, dropped: current?.dropped ?? 0 } : current;
    this.eventWindows.set(declaration.channel, window);
    if (window.carried >= MAX_EVENTS_PER_SECOND) { window.dropped += 1; return; }
    window.carried += 1;
    const dropped = window.dropped;
    window.dropped = 0;
    this.carry?.({ kind: "event", ...addressOf(declaration), value: parsed(json), ...(dropped === 0 ? {} : { dropped }) });
  }

  /** Said once per channel: an extension that publishes wrongly does so on every change. */
  private refuse(channel: string, why: string): void {
    if (this.refused.has(channel)) return;
    this.refused.add(channel);
    this.warn?.(`What an extension published on ${channel} ${why}, so it is not shown.`);
  }
}
