import type { PromptAttachment } from "../../shared/apiTypes";
import { addToHeldComposerAttachments } from "./composerAttachmentHold";
import { joinTakenBack } from "./composerTakeBack";
import { loadDraft, saveDraft } from "./promptDraftStorage";

/**
 * Words of a message that will not run - taken back, or refused for good - for a session the
 * reader is not looking at: they join that session's saved draft, and its images are held for its
 * composer, which picks both up when the session opens. Dropped, they were lost (ponytail review).
 */
export function returnWordsToSavedDraft(sessionKey: string, words: { text: string; attachments: readonly PromptAttachment[] }): void {
  saveDraft(sessionKey, joinTakenBack(loadDraft(sessionKey), words.text));
  addToHeldComposerAttachments(sessionKey, words.attachments.flatMap((attachment) => (attachment.kind === "image" ? [{ kind: "image" as const, name: attachment.name ?? "image", mimeType: attachment.mimeType, data: attachment.data, size: Math.floor((attachment.data.length * 3) / 4) }] : [])));
}
