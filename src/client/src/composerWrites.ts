import type { PromptAttachment } from "./api";
import type { PromptAttachmentDelivery } from "../../shared/apiTypes";
import { isShellInput } from "./inputModes";
import { newClientMessageId } from "./messageDelivery";
import { appendPreparedOperation, type OperationKind, type OperationScope, type PendingPrompt } from "./pendingOutbox";
import type { CapturedAttachment } from "./promptAttachmentCapture";

/**
 * What the composer's draft writes and its Send do that needs no mounted editor, shared by the
 * composer and a page writing for the session on screen (panelComposer.ts): on a phone a page
 * replaces the chat and the composer is not there, yet its message has to go the same way.
 */

/** Dictated text joins whatever is already typed: a transcript must never wipe a half-written message. */
export function withDictatedText(current: string, text: string): string {
  const separator = current === "" || current.endsWith(" ") || current.endsWith("\n") ? "" : " ";
  return `${current}${separator}${text}`;
}

/**
 * A line of words is a message, a slash command, or a `!` shell command; anything with files is a
 * message, and so is `/new` with words after it: as in pi's terminal, only the bare `/new` starts a
 * new session (owner, 2026-10-18).
 */
export function operationKindOf(text: string, withFiles: boolean): OperationKind {
  if (withFiles || /^\/new\s/u.test(text)) return "message";
  if (text.startsWith("/")) return "command";
  return isShellInput(text) ? "shell" : "message";
}

/**
 * Words a page may send as the reader: never a command, so a page's send is no way around the
 * admission of `session.runCommand`. A first `/` is refused whatever follows (a built-in, `/new`
 * with words, a skill or template), and so is a `!` shell command.
 */
export function pageMaySend(text: string): boolean {
  return !text.startsWith("/") && !isShellInput(text);
}

export interface OutgoingOperation {
  readonly kind: OperationKind;
  readonly scope: OperationScope;
  readonly text: string;
  readonly behavior: "steer" | "followUp" | undefined;
  readonly files: { attachments: PromptAttachment[]; delivery: PromptAttachmentDelivery } | undefined;
  /** The plugin that sent it, shown as "Sent with <plugin>"; absent when the reader pressed Send. */
  readonly via: string | undefined;
}

/** Write one operation at the end of a session's outbox; the engine hears the write and sends it. Undefined when this browser could not store it. */
export function writeOutgoingOperation(outboxKey: string, operation: OutgoingOperation): Promise<PendingPrompt | undefined> {
  return appendPreparedOperation(outboxKey, {
    kind: operation.kind,
    scope: operation.scope,
    text: operation.text,
    ...(operation.behavior === undefined ? {} : { behavior: operation.behavior }),
    clientMessageId: newClientMessageId(),
    ...(operation.files ?? {}),
    ...(operation.via === undefined ? {} : { via: operation.via }),
    at: new Date().toISOString(),
  });
}

const composerSendsInFlight = new Map<string, Set<Promise<unknown>>>();

/**
 * A composer's Send for a session's outbox, from the moment it takes the words until they have
 * left the composer, its stored draft and its held files (clearSent). The composer may unmount
 * meanwhile, a page then replacing it on a phone: its stored draft and held files still hold the
 * message, so a page's send of them waits for this (composerSendsSettled) and a message goes once.
 */
export function trackComposerSend<T>(outboxKey: string, send: Promise<T>): Promise<T> {
  if (outboxKey === "") return send;
  const sends = composerSendsInFlight.get(outboxKey) ?? new Set<Promise<unknown>>();
  composerSendsInFlight.set(outboxKey, sends);
  sends.add(send);
  const forget = (): void => {
    sends.delete(send);
    if (sends.size === 0 && composerSendsInFlight.get(outboxKey) === sends) composerSendsInFlight.delete(outboxKey);
  };
  void send.then(forget, forget);
  return send;
}

/** Resolves once no composer Send for the outbox is in flight, including one started while waiting. */
export async function composerSendsSettled(outboxKey: string): Promise<void> {
  for (let sends = composerSendsInFlight.get(outboxKey); sends !== undefined; sends = composerSendsInFlight.get(outboxKey)) {
    await Promise.allSettled([...sends]);
  }
}

/** The sent files gone from a list, compared by content as in `withoutSent`; a sent file not there is skipped. */
export function withoutSentFiles<T extends CapturedAttachment>(attachments: readonly T[], sent: readonly CapturedAttachment[]): T[] {
  const remaining = [...attachments];
  for (const file of sent) {
    const index = remaining.findIndex((candidate) => sameFile(candidate, file));
    if (index !== -1) remaining.splice(index, 1);
  }
  return remaining;
}

function sameFile(a: CapturedAttachment, b: CapturedAttachment): boolean {
  return a.kind === b.kind && a.name === b.name && a.data === b.data;
}

export function promptAttachmentOf(attachment: CapturedAttachment): PromptAttachment {
  if (attachment.kind === "image") {
    return { kind: "image", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
  }
  return { kind: "file", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
}

/**
 * What a composer holds once a message it sent is written: the sent words gone from the front of
 * the text and the sent files from the list, so only what was added meanwhile stays. Undefined when
 * the text no longer begins with the sent words or a sent file is not there: it is not the sent
 * message any more. Files compare by content, since a composer that left and came back holds copies.
 */
export function withoutSent<T extends CapturedAttachment>(draft: string, attachments: readonly T[], sent: { draft: string; attachments: readonly CapturedAttachment[] }): { draft: string; attachments: T[] } | undefined {
  if (!draft.startsWith(sent.draft)) return undefined;
  const remaining = [...attachments];
  for (const file of sent.attachments) {
    const index = remaining.findIndex((candidate) => sameFile(candidate, file));
    if (index === -1) return undefined;
    remaining.splice(index, 1);
  }
  return { draft: draft.slice(sent.draft.length).trimStart(), attachments: remaining };
}
