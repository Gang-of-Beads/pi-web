import { heldWords, hydratePendingPrompt, retireMessage } from "./pendingOutbox";
import { rememberPromptHistory } from "./promptHistory";
import { capturedAttachmentOf } from "./returnedAttachments";

/**
 * The messages a `/new` dropped from behind it, kept in the new session's prompt history on the
 * browser that sent them (owner, 2026-10-17): their rows vanish, and the history button of the
 * session the reader is now in brings their words and attachments back. Only this browser's own
 * messages can be: it holds their words from acceptance until they are over
 * (reserveAcceptedPrompt), and no other browser has them. Remembered oldest first, so the newest
 * is on top.
 */
export async function rememberDroppedPrompts(fromKey: string, toKey: string, dropped: readonly string[]): Promise<void> {
  for (const clientMessageId of dropped) {
    const held = heldWords(fromKey, clientMessageId);
    if (held?.kind !== "message") continue;
    const words = await hydratePendingPrompt(held).catch(() => held);
    rememberPromptHistory(toKey, words.text, (words.attachments ?? []).map(capturedAttachmentOf));
    retireMessage(fromKey, clientMessageId);
  }
}
