/**
 * How much of a tool result travels to a browser.
 *
 * A transcript page answered a request for 100 messages with 15.6 MB, five
 * tool results accounting for 65% of it and the largest a single 2.16 MB row.
 * A phone spends that budget on parsing and layout before it can show
 * anything, which is what "the session never loads" was.
 *
 * The bound applies to what is sent, never to what is stored: the session file
 * keeps every byte, and the row reports the whole size so a reader is told the
 * output continues rather than being shown a silent stump.
 *
 * 128 KiB is far above any result a person reads in a transcript row and far
 * below the size at which a page stops loading; the outliers that motivated
 * this were 16x larger.
 */
export const TOOL_RESULT_TEXT_BYTES = 128 * 1024;

export interface BoundedToolResultText {
  text: string;
  truncated: boolean;
  /** Bytes the whole result had, so the row can say what is missing. */
  totalBytes: number;
}

export function boundToolResultText(text: string, maxBytes = TOOL_RESULT_TEXT_BYTES): BoundedToolResultText {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(text).byteLength;
  if (totalBytes <= maxBytes) return { text, truncated: false, totalBytes };
  let bytes = 0;
  let kept = "";
  // Whole code points only: a cut inside a character hands the browser a
  // broken string, and this transcript is routinely not ASCII.
  for (const codePoint of text) {
    const size = encoder.encode(codePoint).byteLength;
    if (bytes + size > maxBytes) break;
    kept += codePoint;
    bytes += size;
  }
  return { text: kept, truncated: true, totalBytes };
}
