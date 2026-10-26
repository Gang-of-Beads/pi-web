import type { PromptAttachment } from "./api";
import type { DeferredImageRef } from "../../shared/apiTypes";
import type { ChatLine, ChatPart } from "./components/shared";
import type { SentImage } from "./sentImages";

/**
 * Recovering a sent prompt so it can be sent again.
 *
 * When a turn fails after the prompt was delivered — a rate limit, a revoked
 * token, a provider outage — the message is already in the transcript and the
 * user's own copy of it is gone. Retyping is merely tedious; re-attaching the
 * images is the part that makes people give up, because the originals may have
 * come from a share sheet or a screenshot that is no longer at hand.
 *
 * The transcript carries everything needed: an image part holds its MIME type
 * and base64 payload, which is exactly the shape a prompt attachment takes, or,
 * read from history (r158), the reference its bytes are fetched from
 * (sentImages.ts).
 */

export interface RecoveredPrompt {
  text: string;
  attachments: PromptAttachment[];
}

/** A sent message's words and its images in order, a referenced image by the path its bytes come from. */
export interface SentPrompt {
  text: string;
  images: SentImage[];
}

/** Whether a transcript line is a user prompt that could be sent again. */
export function isResendableLine(line: Pick<ChatLine, "role" | "parts">): boolean {
  return sentPromptOf(line, () => undefined) !== undefined;
}

/**
 * The prompt behind a user line, or `undefined` when there is nothing to
 * resend. `pathOf` completes a referenced image's address with the row's
 * machine and session.
 *
 * Only text and images are recovered. A file attachment was already written
 * into the workspace and referenced from the prompt text, so its reference
 * survives in the text itself and re-uploading it would duplicate the file.
 */
export function sentPromptOf(line: Pick<ChatLine, "role" | "parts">, pathOf: (ref: DeferredImageRef) => string | undefined): SentPrompt | undefined {
  if (line.role !== "user") return undefined;

  const textParts: string[] = [];
  const images: SentImage[] = [];
  for (const part of line.parts) {
    if (isTextPart(part)) {
      if (part.text !== "") textParts.push(part.text);
      continue;
    }
    if (part.type !== "image" || part.mimeType === "") continue;
    if (!("data" in part)) images.push({ kind: "referenced", mimeType: part.mimeType, path: pathOf(part.ref) });
    else if (part.data !== "") images.push({ kind: "inline", attachment: { kind: "image", mimeType: part.mimeType, data: part.data } });
  }

  const text = textParts.join("\n\n").trim();
  if (text === "" && images.length === 0) return undefined;
  return { text, images };
}

/** The prompt behind a user line with the images whose bytes it holds; a referenced image needs `sentPromptOf`. */
export function recoverPromptFromLine(line: Pick<ChatLine, "role" | "parts">): RecoveredPrompt | undefined {
  const sent = sentPromptOf(line, () => undefined);
  if (sent === undefined) return undefined;
  return { text: sent.text, attachments: sent.images.flatMap((image) => (image.kind === "inline" ? [image.attachment] : [])) };
}

function isTextPart(part: ChatPart): part is Extract<ChatPart, { type: "text" }> {
  return part.type === "text";
}
