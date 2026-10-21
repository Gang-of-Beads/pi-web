import type { ExtensionNoticeLevel } from "../../shared/apiTypes";
import type { ChatLine, ChatPart } from "./components/shared";

/**
 * An extension's `ctx.ui.notify`, drawn as pi's terminal draws it (extension-ui-counterpart.md,
 * owner 2026-10-04). Info is one dim status line, and the next info replaces it while it is still
 * the transcript's last row, as pi's `showStatus` does; a warning or an error is appended, and the
 * same one again within ten seconds counts up on its line instead of adding another. None of it
 * is saved: a reload, or a device that opens the session later, does not show it.
 */
export const NOTICE_REPEAT_WINDOW_MS = 10_000;

/**
 * Each notice line's own name, kept across its repeats, so a tap opens that line alone: keyed by
 * arrival time, the notices of one flush opened together and a repeat folded an opened one.
 */
let noticeSequence = 0;

function nextNoticeId(): string {
  noticeSequence += 1;
  return `notice-${String(noticeSequence)}`;
}

export type ExtensionNoticePart = Extract<ChatPart, { type: "extensionNotice" }>;

export const NOTICE_PREFIX: Readonly<Record<ExtensionNoticeLevel, string>> = {
  info: "",
  warning: "Warning: ",
  error: "Error: ",
};

export interface NoticeSegment { readonly kind: "text" | "link"; readonly text: string }

const NOTICE_URL = /https?:\/\/[^\s<>"']+/gu;
const URL_TRAILING_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}"]);
const OPENER_OF: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };

function occurrences(text: string, character: string): number {
  return text.split(character).length - 1;
}

/** Sentence punctuation after an address is not part of it, but a closing bracket the address opened is (`Function_(mathematics)`). */
function withoutTrailingPunctuation(candidate: string): string {
  let url = candidate;
  for (let last = url.at(-1); last !== undefined && URL_TRAILING_PUNCTUATION.has(last); last = url.at(-1)) {
    const opener = OPENER_OF[last];
    if (opener !== undefined && occurrences(url, opener) >= occurrences(url, last)) return url;
    url = url.slice(0, -1);
  }
  return url;
}

/**
 * A notice's text with its web addresses marked, so they draw as links a reader can open or copy:
 * login flows put a long authorization URL in a notice, which had to be
 * retyped. Sentence punctuation after an address stays text.
 */
export function noticeSegments(text: string): NoticeSegment[] {
  const segments: NoticeSegment[] = [];
  let at = 0;
  for (const match of text.matchAll(NOTICE_URL)) {
    const url = withoutTrailingPunctuation(match[0]);
    if (match.index > at) segments.push({ kind: "text", text: text.slice(at, match.index) });
    segments.push({ kind: "link", text: url });
    at = match.index + url.length;
  }
  if (at < text.length) segments.push({ kind: "text", text: text.slice(at) });
  return segments;
}

export function withExtensionNotice(messages: ChatLine[], level: ExtensionNoticeLevel, text: string, now: number): ChatLine[] {
  if (level === "info") return withStatusLine(messages, text, now);
  const repeated = lastRepeat(messages, level, text, now);
  if (repeated === undefined) return [...messages, noticeLine({ type: "extensionNotice", id: nextNoticeId(), level, text, count: 1, at: now })];
  const next = [...messages];
  next[repeated.index] = noticeLine({ ...repeated.part, count: repeated.part.count + 1, at: now });
  return next;
}

/** The notice a line is made of, when it is one. */
export function extensionNoticeOf(line: ChatLine): ExtensionNoticePart | undefined {
  const [part] = line.parts;
  return line.parts.length === 1 && part?.type === "extensionNotice" ? part : undefined;
}

function withStatusLine(messages: ChatLine[], text: string, now: number): ChatLine[] {
  const line = noticeLine({ type: "extensionNotice", id: nextNoticeId(), level: "info", text, count: 1, at: now });
  const last = messages[messages.length - 1];
  const replaces = last !== undefined && extensionNoticeOf(last)?.level === "info";
  return replaces ? [...messages.slice(0, -1), line] : [...messages, line];
}

function lastRepeat(messages: readonly ChatLine[], level: ExtensionNoticeLevel, text: string, now: number): { index: number; part: ExtensionNoticePart } | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const line = messages[index];
    const part = line === undefined ? undefined : extensionNoticeOf(line);
    if (part?.level !== level || part.text !== text) continue;
    return now - part.at < NOTICE_REPEAT_WINDOW_MS ? { index, part } : undefined;
  }
  return undefined;
}

function noticeLine(part: ExtensionNoticePart): ChatLine {
  return { role: "system", parts: [part] };
}
