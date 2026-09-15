import type { SessionTranscriptPage, SessionTranscriptPort, SessionTranscriptRef, SessionTranscriptSummary } from "../../../server-plugin-api.js";
import type { ClientMessagePage, ClientSession } from "../../shared/types.js";

/**
 * The session-transcript port a daemon plugin reads through.
 *
 * Plugins activate before the session service exists, and the activation
 * context is frozen, so the port cannot close over the service: it closes
 * over a resolver the daemon satisfies once the service is built. Until
 * then a read is refused with a named error rather than answering an empty
 * page - absence is not negation, and a plugin must not conclude "no
 * sessions" from "not ready yet".
 *
 * Every read goes through the same projection the browser gets: bounded
 * tool results, images by reference. There is deliberately no method that
 * writes, so the daemon stays the only producer of session files.
 */
export interface TranscriptReader {
  list(cwd: string): Promise<readonly ClientSession[]>;
  messages(ref: SessionTranscriptRef, page?: { before?: number; limit?: number }): Promise<ClientMessagePage>;
}

export const TRANSCRIPT_PORT_NOT_READY = "Session transcripts are not readable yet: the session service is still starting";

export function createSessionTranscriptPort(resolveReader: () => TranscriptReader | undefined): SessionTranscriptPort {
  const reader = (): TranscriptReader => {
    const current = resolveReader();
    if (current === undefined) throw new Error(TRANSCRIPT_PORT_NOT_READY);
    return current;
  };
  return Object.freeze({
    async listSessions(cwd: string): Promise<readonly SessionTranscriptSummary[]> {
      const sessions = await reader().list(cwd);
      return sessions.map(summaryOf);
    },
    async readMessages(ref: SessionTranscriptRef, page?: { before?: number; limit?: number }): Promise<SessionTranscriptPage> {
      const result = await reader().messages({ id: ref.id, cwd: ref.cwd }, page);
      return { messages: result.messages, start: result.start, total: result.total };
    },
  });
}

function summaryOf(session: ClientSession): SessionTranscriptSummary {
  return {
    id: session.id,
    cwd: session.cwd,
    ...(session.name === undefined ? {} : { name: session.name }),
    createdAt: session.created,
    updatedAt: session.modified,
    ...(session.archived === undefined ? {} : { archived: session.archived }),
  };
}
