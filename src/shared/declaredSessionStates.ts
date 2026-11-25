/**
 * The session states an extension declares (docs/design/extension-bus.md, "The `piweb` namespace").
 *
 * Core knows the states it observes of the pi runtime: asking, error, working, opening, idle. What a
 * session is doing beyond its own turn (a background run, a subagent, a review) is the extension's to
 * say, in its own words. An extension publishes its states on `piweb:states:<owner>`; every surface
 * reads them through the properties below and never by name, so core carries a state it has never
 * heard of.
 */

/** The channel an owner publishes its states on. */
export const SESSION_STATES_CHANNEL_PREFIX = "piweb:states:";

/** The colour a state wears, from the theme's own tokens; a theme decides what each looks like. */
export type DeclaredStateTone = "accent" | "success" | "warning" | "danger" | "muted";

const TONES: Readonly<Record<DeclaredStateTone, true>> = { accent: true, success: true, warning: true, danger: true, muted: true };

function isTone(value: unknown): value is DeclaredStateTone {
  return typeof value === "string" && Object.hasOwn(TONES, value);
}

export interface DeclaredSessionState {
  /** Who declared it: the owner part of the channel it came on, or `core` for the daemon's own. */
  readonly owner: string;
  /** The declarer's own name for the state, unique under its owner. */
  readonly id: string;
  /** The words a reader sees. */
  readonly label: string;
  readonly tone: DeclaredStateTone;
  /**
   * Work is going on that the session's own turn does not cover. A busy state ranks the session with
   * working ones, holds its place in a list, blocks a folder rename, and keeps the session from being
   * called settled.
   */
  readonly busy: boolean;
  /** How many of it there are, when that is a number worth showing. */
  readonly count?: number;
}

const MAX_STATES_PER_OWNER = 8;
const MAX_LABEL_LENGTH = 80;
const STATE_ID = /^[a-z][a-z0-9.-]{0,63}$/u;

/**
 * What an owner published, as states; undefined when it is not a list of well-formed states, which a
 * caller reports once and otherwise ignores. An empty list is a real answer: the owner has none now.
 */
export function parseDeclaredStates(owner: string, value: unknown): DeclaredSessionState[] | undefined {
  if (!Array.isArray(value) || value.length > MAX_STATES_PER_OWNER) return undefined;
  const states: DeclaredSessionState[] = [];
  for (const entry of value) {
    const state = parseState(owner, entry);
    if (state === undefined || states.some((seen) => seen.id === state.id)) return undefined;
    states.push(state);
  }
  return states;
}

function parseState(owner: string, value: unknown): DeclaredSessionState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { id, label, tone, busy, count }: { id?: unknown; label?: unknown; tone?: unknown; busy?: unknown; count?: unknown } = value;
  if (typeof id !== "string" || !STATE_ID.test(id)) return undefined;
  if (typeof label !== "string" || label.trim() === "" || label.length > MAX_LABEL_LENGTH) return undefined;
  if (!isTone(tone) || typeof busy !== "boolean") return undefined;
  if (count !== undefined && (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)) return undefined;
  return { owner, id, label: label.trim(), tone, busy, ...(count === undefined ? {} : { count }) };
}

/** The states that mean work is going on, in the order they were declared. */
export function busyStates(states: readonly DeclaredSessionState[] | undefined): readonly DeclaredSessionState[] {
  return (states ?? []).filter((state) => state.busy);
}
