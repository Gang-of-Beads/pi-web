import type { PromptAttachment } from "./api";
import { READ_DEADLINE_FOR } from "./api/http";
import { fetchWithDeadline } from "./api/requestDeadline";
import { resolveAppUrl } from "./appUrl";
import type { ReturnedAttachments } from "./returnedAttachments";

/**
 * An image of a message the reader sent, for the features that hand the message back to the
 * composer (Edit and send again, the composer's history): its bytes, or, when the transcript holds
 * it by reference (r158), the app path its bytes are fetched from. `path` is undefined when the
 * row's session was not known, which no fetch can answer.
 */
export type SentImage =
  | { kind: "inline"; attachment: PromptAttachment }
  | { kind: "referenced"; mimeType: string; path: string | undefined };

/**
 * The attachments behind a message's images, the referenced ones fetched now. An image whose
 * fetch fails is counted as one this browser could not read, never left out in silence. The reader
 * asked, so the fetch has the reader's read deadline (30 s), not the 180 s upload one (r158 review:
 * Edit and send again waited for it with nothing on screen) nor the 8 s machine read deadline: a
 * 2.85 MB base64 photo takes about 11 s on the measured 1.6 Mbps link, so 8 s would always fail.
 */
export async function sentImageAttachments(images: readonly SentImage[]): Promise<ReturnedAttachments> {
  const read = await Promise.all(images.map(attachmentOf));
  const attachments = read.filter((attachment): attachment is PromptAttachment => attachment !== undefined);
  const unreadable = read.length - attachments.length;
  return unreadable === 0 ? { attachments } : { attachments, shortfall: { missing: 0, unreadable, unknown: false } };
}

/** A file or blob's bytes as base64, without the data-URL prefix. */
export function readBlobAsBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(reader.error ?? new Error("Failed to read file")); };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") { reject(new Error("Unexpected file reader result")); return; }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(blob);
  });
}

async function attachmentOf(image: SentImage): Promise<PromptAttachment | undefined> {
  if (image.kind === "inline") return image.attachment;
  if (image.path === undefined) return undefined;
  try {
    const blob = await fetchWithDeadline(resolveAppUrl(image.path), {}, async (response) => (response.ok ? await response.blob() : undefined), READ_DEADLINE_FOR.reader);
    return blob === undefined ? undefined : { kind: "image", mimeType: image.mimeType, data: await readBlobAsBase64(blob) };
  } catch {
    return undefined;
  }
}
