/**
 * A note about one message - it could not be taken back, it was not sent - shown under that
 * message in the transcript (owner, 2026-10-14: on the message it is about), never on the app row, which
 * says only whether the page is in step (docs/design/message-states.md, "Words").
 *
 * A note belongs to its session. It leaves `NOTE_SHOWN_MS` after the reader first sees it, or with
 * the reader's next send to that session; one for a session the reader is not looking at waits
 * until the session is opened.
 */
export interface MessageNote {
  readonly sessionKey: string;
  readonly clientMessageId: string;
  readonly text: string;
  /** When the reader first had it on screen; undefined while its session is not open. */
  readonly shownAt: number | undefined;
}

export const NOTE_SHOWN_MS = 8000;

/** A note not yet on screen stays - it waits for its session to open; one on screen goes once it has shown `NOTE_SHOWN_MS`. */
export function notesStillShowing(notes: readonly MessageNote[], now: number): MessageNote[] {
  return notes.filter((note) => note.shownAt === undefined || now - note.shownAt < NOTE_SHOWN_MS);
}

/** The reader opened a session: its waiting notes start their time on screen. */
export function notesSeen(notes: readonly MessageNote[], sessionKey: string, now: number): MessageNote[] {
  return notes.map((note) => (note.sessionKey === sessionKey && note.shownAt === undefined ? { ...note, shownAt: now } : note));
}
