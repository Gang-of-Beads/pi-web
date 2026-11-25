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
export declare const SESSION_STATES_CHANNEL_PREFIX = "piweb:states:";
/** The colour a state wears, from the theme's own tokens; a theme decides what each looks like. */
export type DeclaredStateTone = "accent" | "success" | "warning" | "danger" | "muted";
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
/**
 * What an owner published, as states; undefined when it is not a list of well-formed states, which a
 * caller reports once and otherwise ignores. An empty list is a real answer: the owner has none now.
 */
export declare function parseDeclaredStates(owner: string, value: unknown): DeclaredSessionState[] | undefined;
/** The states that mean work is going on, in the order they were declared. */
export declare function busyStates(states: readonly DeclaredSessionState[] | undefined): readonly DeclaredSessionState[];
