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

export type ExtensionNoticePart = Extract<ChatPart, { type: "extensionNotice" }>;

export const NOTICE_PREFIX: Readonly<Record<ExtensionNoticeLevel, string>> = {
  info: "",
  warning: "Warning: ",
  error: "Error: ",
};

export function withExtensionNotice(messages: ChatLine[], level: ExtensionNoticeLevel, text: string, now: number): ChatLine[] {
  if (level === "info") return withStatusLine(messages, text, now);
  const repeated = lastRepeat(messages, level, text, now);
  if (repeated === undefined) return [...messages, noticeLine({ type: "extensionNotice", level, text, count: 1, at: now })];
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
  const line = noticeLine({ type: "extensionNotice", level: "info", text, count: 1, at: now });
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
