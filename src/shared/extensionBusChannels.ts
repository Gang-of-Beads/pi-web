/**
 * The channels of the extension bus that leave a session (docs/design/extension-bus.md).
 *
 * pi names things by an owner prefix and a colon, by convention (`subagent:async-complete`,
 * `herdr:busy`). A package declares the channels it wants carried, by their full names, under
 * `piWeb.bus` in its `package.json`; everything else an extension emits stays inside the session.
 */

import { isRecord } from "./unknownValues.js";

export type BusChannelKind = "state" | "event" | "request";
export type BusChannelAccess = "own" | "public";

export interface BusChannelDeclaration {
  readonly channel: string;
  readonly kind: BusChannelKind;
  readonly access: BusChannelAccess;
}

const KINDS: Readonly<Record<BusChannelKind, true>> = { state: true, event: true, request: true };
const ACCESS: Readonly<Record<BusChannelAccess, true>> = { own: true, public: true };

function isKind(value: unknown): value is BusChannelKind {
  return typeof value === "string" && Object.hasOwn(KINDS, value);
}

function isAccess(value: unknown): value is BusChannelAccess {
  return typeof value === "string" && Object.hasOwn(ACCESS, value);
}
const CHANNEL = /^[a-z][a-z0-9.-]*(?::[a-z0-9][a-z0-9._/-]*)+$/u;
/** `piweb` is the shell's own, and the only reserved owner a package may declare under: that is how it speaks to the shell. */
const RESERVED_OWNERS: ReadonlySet<string> = new Set(["pi", "core", "machine"]);
const MAX_CHANNELS_PER_PACKAGE = 64;

/** The owner of a channel: the text before its first colon. */
export function busChannelOwner(channel: string): string {
  return channel.slice(0, channel.indexOf(":"));
}

/**
 * A package's `piWeb.bus` as declarations. Throws with the reason when the block is malformed: a
 * package that declares channels wrongly should hear about it, not be silently unbridged.
 */
export function parseBusDeclarations(value: unknown): BusChannelDeclaration[] {
  if (value === undefined) return [];
  if (!isRecord(value)) throw new Error("piWeb.bus must be an object of channel names");
  const entries = Object.entries(value);
  if (entries.length > MAX_CHANNELS_PER_PACKAGE) throw new Error(`piWeb.bus declares more than ${String(MAX_CHANNELS_PER_PACKAGE)} channels`);
  return entries.map(([channel, declared]) => parseDeclaration(channel, declared));
}

function parseDeclaration(channel: string, value: unknown): BusChannelDeclaration {
  if (!CHANNEL.test(channel)) throw new Error(`piWeb.bus channel "${channel}" is not <owner>:<name> in lower case`);
  if (RESERVED_OWNERS.has(busChannelOwner(channel)) || reservedPiWebChannel(channel)) throw new Error(`piWeb.bus channel "${channel}" is under a reserved owner`);
  if (!isRecord(value)) throw new Error(`piWeb.bus channel "${channel}" needs { kind }`);
  const { kind, access } = value;
  if (!isKind(kind)) throw new Error(`piWeb.bus channel "${channel}" needs kind: state, event or request`);
  if (access !== undefined && !isAccess(access)) throw new Error(`piWeb.bus channel "${channel}" has an access that is neither own nor public`);
  return { channel, kind, access: access ?? "own" };
}

const STATES_PREFIX = "piweb:states:";
const RESERVED_STATE_OWNERS: ReadonlySet<string> = new Set([...RESERVED_OWNERS, "piweb", "plugins"]);

/** Under `piweb`, a package may declare only its session states, and not under a name PI WEB publishes its own states as. */
function reservedPiWebChannel(channel: string): boolean {
  if (busChannelOwner(channel) !== "piweb") return false;
  return !channel.startsWith(STATES_PREFIX) || RESERVED_STATE_OWNERS.has(channel.slice(STATES_PREFIX.length));
}
