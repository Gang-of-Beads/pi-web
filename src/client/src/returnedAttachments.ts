import type { PromptAttachment } from "./api";
import type { CapturedAttachment } from "./promptAttachmentCapture";

/**
 * What a message handed back to the composer brings of its attachments: taken back, stopped,
 * cleared from the queue, or recalled from history.
 *
 * Every one of those returned the words and, from most doors, nothing else; the reader could not
 * tell "it had none" from "they were left behind". Absence is not negation: a device that has no
 * copy of a message's attachments says how many it is missing, and one that cannot even tell
 * whether there were any says that.
 */
export interface AttachmentShortfall {
  /** Attachments the message had that this browser holds no copy of. */
  missing: number;
  /** Nothing said whether the message had attachments at all. */
  unknown: boolean;
}

export interface ReturnedAttachments {
  attachments: PromptAttachment[];
  shortfall?: AttachmentShortfall;
}

export type AttachmentReturnState = "complete" | "missing" | "unknown";

/**
 * `known` is the message as some trustworthy copy holds it - this browser's own outbox or reserve,
 * or a transcript line - and undefined when there is none. `imageCount` is the daemon's word on a
 * queued message, undefined when it gave none.
 */
export function attachmentReturnState(known: readonly PromptAttachment[] | undefined, imageCount: number | undefined): AttachmentReturnState {
  if (imageCount === undefined) return known === undefined ? "unknown" : "complete";
  return imagesIn(known ?? []) >= imageCount ? "complete" : "missing";
}

const RETURNED: Readonly<Record<AttachmentReturnState, (known: readonly PromptAttachment[], imageCount: number) => ReturnedAttachments>> = {
  complete: (known) => ({ attachments: [...known] }),
  missing: (known, imageCount) => ({ attachments: [...known], shortfall: { missing: imageCount - imagesIn(known), unknown: false } }),
  unknown: () => ({ attachments: [], shortfall: { missing: 0, unknown: true } }),
};

export function returnedAttachments(known: readonly PromptAttachment[] | undefined, imageCount: number | undefined): ReturnedAttachments {
  return RETURNED[attachmentReturnState(known, imageCount)](known ?? [], imageCount ?? 0);
}

/** Several messages returned together owe one account of what stayed behind. */
export function combinedShortfall(shortfalls: readonly (AttachmentShortfall | undefined)[]): AttachmentShortfall | undefined {
  const present = shortfalls.filter((shortfall): shortfall is AttachmentShortfall => shortfall !== undefined);
  if (present.length === 0) return undefined;
  return { missing: present.reduce((total, shortfall) => total + shortfall.missing, 0), unknown: present.some((shortfall) => shortfall.unknown) };
}

export function attachmentShortfallNote(shortfall: AttachmentShortfall | undefined): string | undefined {
  if (shortfall === undefined) return undefined;
  const sentences = [
    ...(shortfall.missing > 0 ? [`${String(shortfall.missing)} attachment${shortfall.missing === 1 ? "" : "s"} did not come back: this browser has no copy.`] : []),
    ...(shortfall.unknown ? ["This browser cannot tell whether the message had attachments."] : []),
  ];
  return sentences.length === 0 ? undefined : sentences.join(" ");
}

export function isAttachmentShortfall(value: unknown): value is AttachmentShortfall {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "missing") === "number" && typeof Reflect.get(value, "unknown") === "boolean";
}

/** A returned attachment as the composer holds one; an unnamed one is named by its kind and place. */
export function capturedAttachmentOf(attachment: PromptAttachment, index: number): CapturedAttachment {
  return {
    kind: attachment.kind,
    name: attachment.name ?? `${attachment.kind}-${String(index + 1)}`,
    mimeType: attachment.mimeType,
    data: attachment.data,
    size: Math.floor((attachment.data.length * 3) / 4),
  };
}

function imagesIn(attachments: readonly PromptAttachment[]): number {
  return attachments.filter((attachment) => attachment.kind === "image").length;
}
