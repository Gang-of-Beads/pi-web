import type { ComposerSendResult, PluginPanelComposer, PluginPanelDraftWrite, PluginPanelSendResult } from "../../shared/pluginApiTypes";
import { holdComposerAttachments, restoreHeldComposerAttachments, takeHeldComposerAttachments } from "./composerAttachmentHold";
import { currentComposerScope, sameComposerScope, type ComposerScope } from "./composerScope";
import { joinTakenBack } from "./composerTakeBack";
import { operationKindOf, pageMaySend, promptAttachmentOf, withDictatedText, writeOutgoingOperation } from "./composerWrites";
import { machineSessionKey } from "./machineKeys";
import type { OperationScope, PendingPrompt } from "./pendingOutbox";
import { effectivePromptAttachmentDelivery, type CapturedAttachment } from "./promptAttachmentCapture";
import { clearDraft, loadDraft, saveDraft } from "./promptDraftStorage";
import { rememberPromptHistory } from "./promptHistory";

/** The composer as a page reaches it while it is drawn (PromptEditor). */
export interface MountedComposer {
  showsScope(scope: ComposerScope): boolean;
  draftText(): string;
  writeScopedDraft(bound: ComposerScope, nextDraft: (current: string) => string): void;
  sendBoundDraft<Refusal extends string = never>(bound: ComposerScope, via: string, refusal?: (words: string) => Refusal | undefined): Promise<ComposerSendResult | Refusal>;
}

export interface PanelComposerHost {
  /** The session on screen when the page's context was made. */
  readonly bound: { readonly machineId: string; readonly sessionId: string };
  /** The plugin the page belongs to, recorded on what it sends. */
  readonly via: string;
  /** The session on screen now, if any. */
  shownScope(): ComposerScope | undefined;
  /** The composer, while it is drawn. */
  mountedComposer(): MountedComposer | undefined;
  /** The folder the session on screen runs in, as the composer reads it. */
  sessionCwd(): string | undefined;
  /** Whether a turn runs or a compaction holds the session on screen, as its composer reads them. */
  sessionActivity(): { readonly isStreaming?: boolean | undefined; readonly isCompacting?: boolean | undefined } | undefined;
  /** A message was written to the outbox: show its Sending row, as the composer's writes do. */
  onOutgoingWritten(record: PendingPrompt): void;
}

/**
 * The draft and Send of the session on screen for a workspace page (`WorkspacePanelContext.composer`).
 * While the composer is drawn on that session, every member goes through it exactly as a composer
 * control's would; while it is not (a phone, where the page replaces the chat), the session's stored
 * draft and held attachments are used through the same editor-free writes (composerWrites.ts).
 */
export function createPanelComposer(host: PanelComposerHost): PluginPanelComposer {
  const bound: ComposerScope = host.bound;
  const onScreen = (): boolean => {
    const shown = host.shownScope();
    return shown !== undefined && sameComposerScope(currentComposerScope(bound), shown);
  };
  const shownComposer = (): MountedComposer | undefined => {
    const composer = host.mountedComposer();
    return composer?.showsScope(bound) === true ? composer : undefined;
  };
  const writeDraft = (nextDraft: (current: string) => string): PluginPanelDraftWrite => {
    if (!onScreen()) return "left";
    const composer = shownComposer();
    if (composer !== undefined) {
      composer.writeScopedDraft(bound, nextDraft);
      return "written";
    }
    const key = boundKey(bound);
    return saveDraft(key, nextDraft(loadDraft(key))) ? "written" : "not-stored";
  };
  return {
    draft: () => shownComposer()?.draftText() ?? loadDraft(boundKey(bound)),
    setDraft: (text) => writeDraft(() => text),
    insertText: (text) => writeDraft((current) => withDictatedText(current, text)),
    send: (text) => {
      if (!onScreen()) return Promise.resolve("left");
      if (text !== undefined) return sendWords(host, text);
      const composer = shownComposer();
      if (composer !== undefined) return composer.sendBoundDraft(bound, host.via, commandRefusal);
      return oneStoredSendAtATime(boundKey(bound), () => sendStoredDraft(host, onScreen, shownComposer));
    },
  };
}

function boundKey(bound: ComposerScope): string {
  const current = currentComposerScope(bound);
  return machineSessionKey(current.machineId, current.sessionId ?? "");
}

function commandRefusal(words: string): "command" | undefined {
  return pageMaySend(words) ? undefined : "command";
}

/** As the composer's Send goes: a steer while a turn runs, a follow-up while a compaction holds the session, else neither. */
function sendBehavior(activity: ReturnType<PanelComposerHost["sessionActivity"]>): "steer" | "followUp" | undefined {
  if (activity?.isStreaming === true) return "steer";
  return activity?.isCompacting === true ? "followUp" : undefined;
}

function operationScopeOf(host: PanelComposerHost): OperationScope | undefined {
  const { machineId, sessionId } = currentComposerScope(host.bound);
  const cwd = host.sessionCwd();
  if (sessionId === undefined || sessionId === "" || cwd === undefined || cwd === "") return undefined;
  return { machineId, sessionId, cwd };
}

/** Words the page gives, sent as a message of their own; the draft is left alone. */
async function sendWords(host: PanelComposerHost, text: string): Promise<PluginPanelSendResult> {
  const words = text.trim();
  if (words === "") return "empty";
  const refused = commandRefusal(words);
  if (refused !== undefined) return refused;
  const scope = operationScopeOf(host);
  if (scope === undefined) return "not-stored";
  const written = await writeOutgoingOperation(boundKey(host.bound), { kind: "message", scope, text: words, behavior: sendBehavior(host.sessionActivity()), files: undefined, via: host.via }).catch(() => undefined);
  if (written === undefined) return "not-stored";
  host.onOutgoingWritten(written);
  return "sent";
}

/**
 * Send the stored draft and held attachments of a session whose composer is not drawn, and clear
 * them as Send clears the composer. Two of these for one session run one after the other, so a
 * draft goes at most once. A composer drawn on the session before the send holds the draft and
 * sends it instead. The draft leaves storage before the outbox write, as the files do: a composer
 * drawn during the write (the reader went back to the chat) restores nothing, so its Send cannot
 * write the same words again. A failed write gives the words back where the reader sees them.
 */
async function sendStoredDraft(host: PanelComposerHost, onScreen: () => boolean, shownComposer: () => MountedComposer | undefined): Promise<PluginPanelSendResult> {
  const key = boundKey(host.bound);
  await restoreHeldComposerAttachments(key);
  if (!onScreen()) return "left";
  const composer = shownComposer();
  if (composer !== undefined) return composer.sendBoundDraft(host.bound, host.via, commandRefusal);
  const draft = loadDraft(key);
  const text = draft.trim();
  const files = takeHeldComposerAttachments(key);
  const settle = (unsent: readonly CapturedAttachment[]): void => { holdComposerAttachments(key, [...unsent, ...takeHeldComposerAttachments(key)]); };
  if (text === "" && files.length === 0) return "empty";
  const refused = commandRefusal(text);
  const scope = operationScopeOf(host);
  if (refused !== undefined || scope === undefined) {
    settle(files);
    return refused ?? "not-stored";
  }
  const attachments = files.map((file) => promptAttachmentOf(file));
  clearDraft(key);
  const written = await writeOutgoingOperation(key, {
    kind: operationKindOf(text, files.length > 0),
    scope,
    text,
    behavior: sendBehavior(host.sessionActivity()),
    files: files.length === 0 ? undefined : { attachments, delivery: effectivePromptAttachmentDelivery("inline", files) },
    via: host.via,
  }).catch(() => undefined);
  if (written === undefined) {
    giveDraftBack(host.bound, key, draft, shownComposer());
    settle(files);
    return "not-stored";
  }
  settle([]);
  rememberPromptHistory(key, text, files);
  host.onOutgoingWritten(written);
  return "sent";
}

/** Words whose write failed go back after whatever the reader typed meanwhile, into the composer if it is drawn. */
function giveDraftBack(bound: ComposerScope, key: string, draft: string, composer: MountedComposer | undefined): void {
  if (composer !== undefined) {
    composer.writeScopedDraft(bound, (current) => joinTakenBack(current, draft));
    return;
  }
  saveDraft(key, joinTakenBack(loadDraft(key), draft));
}

const storedDraftSends = new Map<string, Promise<unknown>>();

function oneStoredSendAtATime<T>(key: string, send: () => Promise<T>): Promise<T> {
  const next = (storedDraftSends.get(key) ?? Promise.resolve()).then(send, send);
  storedDraftSends.set(key, next);
  const forget = (): void => { if (storedDraftSends.get(key) === next) storedDraftSends.delete(key); };
  void next.then(forget, forget);
  return next;
}
