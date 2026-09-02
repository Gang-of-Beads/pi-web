import type { SessionPersistenceState } from "./sessionPersistence.js";

/** What "the daemon does not have this session" means for the session at hand. */
export type SessionMissingMeaning =
  | { kind: "not-yet-synced"; notice: string }
  | { kind: "gone"; notice: string }
  | { kind: "unknown"; notice: string };

/**
 * How to report a session the daemon says it does not have.
 *
 * "Session not found" is true of the daemon and misleading to the reader. A
 * session this browser has only just asked for is not lost - it has not been
 * written yet, and the same words that describe a deleted session describe one
 * that is thirty milliseconds young. The reader cannot tell whether to wait or
 * to give up, so they give up on work that was about to exist.
 *
 * The persistence state answers it. A session known to be transient is still
 * arriving; a session known to be persisted and now missing has genuinely gone;
 * and a session whose state nobody has established says so rather than picking
 * the frightening reading or the reassuring one.
 */
export function sessionMissingMeaning(persistence: SessionPersistenceState): SessionMissingMeaning {
  switch (persistence) {
    case "transient":
      return { kind: "not-yet-synced", notice: "Still syncing this session." };
    case "persisted":
      return { kind: "gone", notice: "This session is no longer on the machine." };
    case "unknown":
      return { kind: "unknown", notice: "Cannot tell whether this session exists yet." };
  }
}
