import type { PromptAttachment } from "./api";
import type { ChatLine, ChatPart } from "./components/shared";

/**
 * Recovering a sent prompt so it can be sent again.
 *
 * When a turn fails after the prompt was delivered — a rate limit, a revoked
 * token, a provider outage — the message is already in the transcript and the
 * user's own copy of it is gone. Retyping is merely tedious; re-attaching the
 * images is the part that makes people give up, because the originals may have
 * come from a share sheet or a screenshot that is no longer at hand.
 *
 * The transcript carries everything needed: image parts hold their MIME type
 * and base64 payload, which is exactly the shape a prompt attachment takes.
 */

export interface RecoveredPrompt {
  text: string;
  attachments: PromptAttachment[];
}

/** Whether a transcript line is a user prompt that could be sent again. */
export function isResendableLine(line: Pick<ChatLine, "role" | "parts">): boolean {
  if (line.role !== "user") return false;
  const recovered = recoverPromptFromLine(line);
  return recovered !== undefined;
}

/**
 * Rebuild the prompt behind a user line, or `undefined` when there is nothing
 * to resend.
 *
 * Only text and images are recovered. A file attachment was already written
 * into the workspace and referenced from the prompt text, so its reference
 * survives in the text itself and re-uploading it would duplicate the file.
 */
export function recoverPromptFromLine(line: Pick<ChatLine, "role" | "parts">): RecoveredPrompt | undefined {
  if (line.role !== "user") return undefined;

  const textParts: string[] = [];
  const attachments: PromptAttachment[] = [];
  for (const part of line.parts) {
    if (isTextPart(part)) {
      if (part.text !== "") textParts.push(part.text);
      continue;
    }
    if (part.type === "image" && part.data !== "" && part.mimeType !== "") {
      attachments.push({ kind: "image", mimeType: part.mimeType, data: part.data });
    }
  }

  const text = textParts.join("\n\n").trim();
  if (text === "" && attachments.length === 0) return undefined;
  return { text, attachments };
}

/**
 * The most recent resendable user prompt, which is what a retry after a failed
 * turn should offer. Searched from the end so a long transcript costs nothing.
 */
export function lastResendablePrompt(lines: readonly Pick<ChatLine, "role" | "parts">[]): RecoveredPrompt | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const recovered = recoverPromptFromLine(line);
    if (recovered !== undefined) return recovered;
  }
  return undefined;
}

function isTextPart(part: ChatPart): part is Extract<ChatPart, { type: "text" }> {
  return part.type === "text";
}
