/**
 * Internal per-machine status contract shared by sessiond, the web tier, and
 * the browser.
 *
 * sessiond resolves `cwd → workspace → project` and rolls status up, so the
 * browser never attributes anything itself: it renders whatever node flags the
 * snapshot carries. The types crossed into the plugin API when the machines
 * contract started carrying runtime values; they remain a wire projection,
 * not a plugin extension point.
 */
/**
 * Status of a single node (machine, project, workspace, or the unattributed
 * bucket), as an open map keyed by qualified flag id.
 *
 * The map is open because PI WEB federates across machines running different
 * versions, so a browser regularly reads snapshots produced by a daemon that
 * knows flags it does not. Because parents are rolled up on the server, an
 * unrecognised flag id still produces correct parent state; the client only
 * loses per-flag styling. It is not a plugin extension point.
 *
 * Publishers emit only flags that are set, so an absent id means "not set",
 * never "unknown". Readers still tolerate an explicit `false`.
 */
export type StatusFlags = Readonly<Record<string, boolean>>;
/**
 * Complete status projection for one machine. There is no delta encoding:
 * every message carries the whole tree.
 */
export interface MachineStatusSnapshot {
    /** Daemon instance identity. A change means "discard everything you had". */
    epochId: string;
    /** Monotonic within an epoch. Higher wins; equal or lower is ignored. */
    revision: number;
    /** Roll-up of `projects`, `workspaces`, and `unattributed`. */
    machine: StatusFlags;
    /** Keyed by project id. */
    projects: Readonly<Record<string, StatusFlags>>;
    /** Keyed by workspace id. */
    workspaces: Readonly<Record<string, StatusFlags>>;
    /** Roll-up of active cwds that map to no known workspace. */
    unattributed: StatusFlags;
    generatedAt: string;
}
/**
 * Realtime frame carrying a complete snapshot. There is no delta frame, so a
 * receiver either accepts the whole tree or keeps the one it already had.
 */
export interface MachineStatusUiEvent {
    type: "machine.status";
    status: MachineStatusSnapshot;
}
/** The complete set of flags PI WEB itself publishes today. */
export declare const CORE_STATUS_FLAGS: {
    /** A session in the subtree has work in progress (`isSessionActive`). */
    readonly working: "core:working";
    /** A live terminal in the subtree. */
    readonly terminal: "core:terminal";
    /** An unread session completion in the subtree. */
    readonly unread: "core:unread";
};
/**
 * Combine child flags into a parent node. A flag is set on the parent when it
 * is set on any child, and unset flags are omitted so that two trees carrying
 * the same status compare equal by structure.
 */
export declare function rollUpStatusFlags(sources: Iterable<StatusFlags>): StatusFlags;
/**
 * Parse a snapshot received over HTTP or the realtime socket.
 *
 * Structural fields are required, because a snapshot missing them cannot be
 * ordered or rendered. Flag content is tolerated instead: an unrecognised flag
 * id is kept as-is so it still contributes an indicator, and an entry whose
 * value is not a boolean is dropped rather than failing the whole payload,
 * since a newer daemon adding flags must never blank a machine's status.
 */
export declare function parseMachineStatusSnapshot(value: unknown): MachineStatusSnapshot | undefined;
