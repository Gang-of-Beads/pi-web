import type { PromptAttachment } from "../../shared/apiTypes";
import { addToHeldComposerAttachments } from "./composerAttachmentHold";
import { joinTakenBack } from "./composerTakeBack";
import { loadDraft, saveDraft } from "./promptDraftStorage";
import { capturedAttachmentOf } from "./returnedAttachments";

const RETURNED_WORDS_NOT_STORED = "This browser could not store the draft, so the words that came back to that session were not kept.";

/** The one notice owed for words returned to a saved draft: that they were not kept, when the draft refused them, then `note` (why they came back, what did not). */
export function returnedWordsNotice(stored: boolean, note: string | undefined): string | undefined {
  const sentences = [...(stored ? [] : [RETURNED_WORDS_NOT_STORED]), ...(note === undefined ? [] : [note])];
  return sentences.length === 0 ? undefined : sentences.join(" ");
}

/**
 * Words of a message that will not run - taken back, or refused for good - for a session the
 * reader is not looking at: they join that session's saved draft, and its attachments are held for
 * its composer, which picks both up when the session opens. Dropped, they were lost (ponytail review).
 * False when the draft could not be stored: the words are then gone, and the caller says so
 * (`returnedWordsNotice`).
 */
export function returnWordsToSavedDraft(sessionKey: string, words: { text: string; attachments: readonly PromptAttachment[] }): boolean {
  const stored = saveDraft(sessionKey, joinTakenBack(loadDraft(sessionKey), words.text));
  addToHeldComposerAttachments(sessionKey, words.attachments.map(capturedAttachmentOf));
  return stored;
}
