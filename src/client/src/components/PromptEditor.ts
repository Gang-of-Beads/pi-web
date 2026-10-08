import type { EditorView } from "@codemirror/view";
import { renderCrossIcon, renderUpIcon, uiIconStyle } from "./uiIcons.js";
import * as composerEditor from "./composerEditorSetup";
import { keyBelongsToInputMethod } from "./keyboardEventTarget";

type ComposerEditorModule = typeof composerEditor;
import { css, unsafeCSS, LitElement, html, nothing, type PropertyValues } from "lit";
import { pendingPromptActions, trayState } from "../pendingPromptActions";
import { joinTakenBack } from "../composerTakeBack";
import { settleOutbox } from "../outboxSettlement";
import { SHORT_VIEWPORT_MEDIA_QUERY as shortViewportMediaQuery } from "../breakpoints";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, type FileSuggestion, type PromptAttachment, type SessionModel, type SessionStatus, type SlashCommand } from "../api";
import type { PromptAttachmentDelivery } from "../../../shared/apiTypes";
import type { ComposerRuntimeContext, ComposerSlot, QualifiedComposerContribution } from "../plugins/types";
import { capturePromptAttachments, effectivePromptAttachmentDelivery, isInlinePromptAttachment, type CapturedAttachment } from "../promptAttachmentCapture";
import { dataTransferHasFiles, filesFromDataTransfer } from "../fileDrop";
import { inputModeForDraft, inputModesEqual, type InputMode } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, type PromptCompletionTrigger } from "../promptCompletions";
import { clearDraft, loadDraft, restoresDraftOnFirstRender, savesOutgoingDraft, saveDraft } from "../promptDraftStorage";
import { addToHeldComposerAttachments, holdComposerAttachments, takeHeldComposerAttachments } from "../composerAttachmentHold";
import { advancePendingPrompt, isNetworkFailure, linkReportedOffline, loadPendingPrompts, markUnansweredPrompt, NetworkSendError, replaysRecord, reserveAcceptedPrompt, forgetPendingPrompt, savePendingPrompt, OUTBOX_CHANGED_EVENT, SendScopeChangedError, type PendingPrompt, type SendReplay, type SendScope } from "../pendingOutbox";
import { outgoingStopped } from "../outgoingMessages";
import { classifySubmission, handleOutcome, transportFactsFor } from "../messageLifecycle";
import { isRequestTimeout } from "../api/requestDeadline";
import { newClientMessageId } from "../messageDelivery";
import { historyIndexStep, type HistoryDirection, loadPromptHistory, rememberPromptHistory, searchPromptHistory } from "../promptHistory";
import { createMobilePromptEnterMedia, readPromptEnterPreference, shouldSendPromptOnEnterShortcut, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { type CompletionItem} from "./shared";
import { renderAttachIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";
import "./PromptHistoryPanel";

export const promptEditorStyles = css`${unsafeCSS(uiIconStyle)}
  /* Mobile browsers paint a rectangular highlight on tap, which looks pasted-on
     over a round or rounded control. Suppressed in favour of the app's own
     pressed and focus styling; :focus-visible still shows keyboard focus, so
     nothing is lost for keyboard users. */
  button, [role="button"], a, summary, label, input, select { font: var(--pi-text-xs) var(--pi-font-ui); line-height: inherit; -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
  /* Motion is a preference, not a decoration: a user who asks for less of it
     gets none. Kept to a blanket rule because every animation here is
     ornamental — progress bars, pulses, fades — so there is no reduced variant
     worth designing separately. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }

  /* A pending image attachment opens full-size in its own dialog: the native
     top layer covers the page, Esc and a backdrop click close it, and the
     controls are reachable by keyboard like every other control in the app. */
  dialog.attachment-zoom { box-sizing: border-box; position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.attachment-zoom[open] { display: flex; }
  dialog.attachment-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .attachment-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { font: var(--pi-text-xs) var(--pi-font-ui); line-height: inherit; touch-action: manipulation; }
  :host { position: relative; z-index: 5; display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); line-height: inherit; }
    /* Control chrome, not content: buttons and labels here are not copy targets. (T1/T3) */
    :host, :host * { -webkit-user-select: none; user-select: none; }
    :host textarea, :host input, :host [contenteditable], :host .attachment-error { -webkit-user-select: text; user-select: text; }
  footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--pi-space-4); padding: var(--pi-space-6) var(--pi-chat-gutter); border-top: 1px solid var(--pi-border); max-width: var(--pi-chat-measure, 100%); margin-inline: auto; }
  /* Same column as the expanded composer and the transcript: the private
     10px inset made the box edge jump 6px one way on desktop and the other
     way on the phone when the composer collapsed. */
  .expand-composer { box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-4); width: 100%; min-height: var(--pi-control-height-touch); padding: var(--pi-space-2) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-muted); font: inherit; font-size: var(--pi-text-sm); text-align: start; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .expand-composer:focus-visible { border-color: var(--pi-accent); color: var(--pi-text-bright); outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
  @media (hover: hover) { .expand-composer:hover { border-color: var(--pi-accent); color: var(--pi-text-bright); } }
  .expand-composer-label { flex: 0 0 auto; }
  .expand-composer-hint { display: inline-flex; flex: 0 0 auto; margin-inline-start: auto; color: var(--pi-muted); }
  .expand-composer-hint .ui-icon { width: var(--pi-dot-md); height: var(--pi-dot-md); }
  .expand-composer-draft { min-width: 0; overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-xs); text-overflow: ellipsis; white-space: nowrap; }
  /* Desktop only (owner, 2026-09-29): the action row gets the same space below it as above it,
     the gap from the input. The phone's bar rule centres the row on its own. */
  @media not ((pointer: coarse) or (max-width: 760px)) {
    footer { padding-bottom: var(--pi-space-4); }
  }
  footer.shell-mode { border-top-color: var(--pi-success); background: var(--pi-success-bg); }
  .editor-wrap { min-width: 0; }
  /* The clip is clamped against the box it floats in, so that box must be the
     input itself and nothing else: anchored to the whole wrap it measured the
     hints above the field too, and on a short viewport with the keyboard up it
     stood taller than the 40px field and spilled over the border. */
  .editor-box { position: relative; min-width: 0; display: grid; }
  /* One height for everything in the row: a control that brings its own box (the model
     chip, a plugin's control) used to sit taller than the icon buttons beside it. The
     button selector is specific enough not to depend on where a plugin's own sheet lands. */
  .actions > * { box-sizing: border-box; align-self: center; }
  .actions button { box-sizing: border-box; height: var(--pi-control-height-comfort); min-height: var(--pi-control-height-comfort); }
  .actions { display: flex; gap: var(--pi-space-4); align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
  .actions button { line-height: var(--pi-panel-header-control-height); }
  .compact-status { display: flex; min-width: 0; align-items: center; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); flex: 1 1 0; }
  .compact-status > button { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .select-model { max-width: min(42vw, 320px); min-height: var(--pi-control-height-comfort); display: inline-flex; align-items: center; box-sizing: border-box; }
  .select-model-label { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; overflow: hidden; }
  /* Separate boxes so the provider gives way first and the model id survives. */
  .select-model-provider { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .select-model-id { flex: 0 0 auto; white-space: nowrap; }
  .icon-button { position: relative; flex: 0 0 auto; display: inline-grid; place-items: center; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); box-sizing: border-box; padding: 0; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .send-button:not(:disabled) { color: var(--pi-accent, var(--pi-text)); }
  .stop-button:not(:disabled) { color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  /* Inside the field, not over its edge: on a phone the field is 40px tall at
     one line and a 36px control with an 8px offset stood past the top rule. */
  /* The clip sat 2px off the box's inner corner, which read as stuck to the
     border; it keeps the same breathing room the text inside does. */
  /* The clip is anchored inside the box, so it must never be taller than the
     box: a one-line composer on a short viewport is 40px, and a 32px control
     plus its two 6px gaps is 44 - it spilled over the border, which is the
     overflow reported twice now. It shrinks with the box instead. */
  button.editor-attach { position: absolute; right: var(--pi-space-3); bottom: var(--pi-space-3); z-index: 2; box-sizing: border-box; width: min(var(--pi-control-height), calc(100% - 2 * var(--pi-space-3))); height: min(var(--pi-control-height), calc(100% - 2 * var(--pi-space-3))); aspect-ratio: 1; }
  .editor-attach .prompt-action-icon { width: 18px; height: 18px; }
  textarea, .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 54px; max-height: 220px; resize: none; overflow: hidden; border-radius: var(--pi-radius-md); border: 1px solid var(--pi-border); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); line-height: inherit; }
  textarea { overflow-y: auto; padding: var(--pi-space-4); padding-right: calc(var(--pi-space-3) + var(--pi-control-height) + var(--pi-space-3)); }
  /* A phone with the keyboard open leaves roughly 400px of viewport, and a
     composer sized for a full screen took 119px of it - the transcript was
     left with about two lines. The composer keeps a floor so it stays usable
     and gives the rest back to what is being read. */
  @media ${unsafeCSS(shortViewportMediaQuery)} {
    textarea, .markdown-editor .cm-editor { min-height: 40px; max-height: 22dvh; }
    .markdown-editor .cm-scroller { max-height: 22dvh; }
    .markdown-editor .cm-content { min-height: 28px; }
  }
  .markdown-editor .cm-scroller { max-height: 220px; overflow-y: auto; font-family: var(--pi-control-font-family, system-ui, sans-serif); line-height: 1.4; }
  .markdown-editor .cm-content { min-height: 38px; padding: var(--pi-space-4) 44px var(--pi-space-4) var(--pi-space-4); caret-color: var(--pi-text); text-align: start; unicode-bidi: plaintext; --pi-composer-pad: 8px; }
  .markdown-editor .cm-cursor, .markdown-editor .cm-dropCursor { border-left-width: 2px; }
  /* The caret should sit on the line the text will occupy: 1.4 * font-size is
     the line's height, and centering a caret of that height in the line box
     keeps it visually aligned with the surrounding text instead of hanging
     lower -- the old 1.25em + margin approach drifted as the font size changed. */
  .markdown-editor .cm-cursor { height: 1.4em !important; }
  /* An empty document still has one line, and a min-height on the content
     stretches that single line box to fill it. The caret is sized from the line
     box, so before the first keystroke it rendered at the full height of the
     editor and then snapped down once text arrived. Pinning the line box to the
     text's own line-height keeps the caret the same size whether or not
     anything has been typed; the editor keeps its minimum size through the
     container, not by inflating the line. */
  .markdown-editor .cm-line { padding: 0; min-height: calc(var(--pi-control-font-size, 16px) * 1.4); line-height: 1.4; unicode-bidi: plaintext; }
  /* The placeholder renders inside the first line, so a hint long enough to
     wrap made the empty line as tall as the wrapped text. The caret is sized
     from that line box, which is why it towered over the input until the first
     keystroke removed the placeholder. Taking it out of flow lets the empty
     line keep the height of a single line of text, and the caret with it. */
  /* Out of flow so a wrapped hint cannot inflate the empty line (and with it
     the caret), but still anchored to the content's text area: the content has
     8px of left padding, and a placeholder spanning the box edge paints the
     hint 8px left of where the first keystroke will land -- the caret visibly
     overlapping the first character. */
  .markdown-editor .cm-placeholder { position: absolute; inset-block: 0; left: var(--pi-space-4); right: 44px; display: flex; align-items: center; pointer-events: none; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  /* Two parts, not one sentence: the prompt sits at the reading edge and the
     trigger characters group at the trailing edge, quiet enough to read as a
     hint. */
  .composer-placeholder { display: flex; flex: 1 1 auto; align-items: center; justify-content: space-between; gap: var(--pi-space-4); min-width: 0; }
  .composer-placeholder-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .composer-placeholder-hints { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-xs); letter-spacing: normal; }
  /* CodeMirror suppresses its own outline, so the focus ring belongs on the
     bordered box the user actually sees. Without this the composer was the one
     control in the app that gave no sign of being focused. */
  .markdown-editor .cm-focused { outline: none; }
  .markdown-editor:focus-within .cm-editor { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-ring, var(--pi-accent)); }
  /* drawSelection() renders the caret and selection itself, and CodeMirror's
     base colors for them assume a light editor (black caret, pale selection).
     Re-theme them so they stay readable in every pi-web theme. The focused
     selection rule must outspecify CodeMirror's base rule for the focused
     selection background. */
  .markdown-editor .cm-cursor { border-left-color: var(--pi-text); }
  .markdown-editor .cm-editor .cm-selectionBackground { background: color-mix(in srgb, var(--pi-text) 18%, transparent); }
  .markdown-editor .cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: color-mix(in srgb, var(--pi-accent) 32%, transparent); }  .shell-mode textarea, .shell-mode .markdown-editor .cm-editor { border-color: var(--pi-success); box-shadow: 0 0 0 1px var(--pi-success-ring); }
  .mode-hint-problem { border-color: var(--pi-danger); background: var(--pi-danger-bg, var(--pi-surface)); color: var(--pi-danger); }
  .mode-hint { justify-self: start; border: 1px solid var(--pi-success-border); border-radius: var(--pi-radius-pill); background: var(--pi-success-surface); color: var(--pi-success); padding: var(--pi-space-1) var(--pi-space-4); font-size: var(--pi-text-xs); pointer-events: none; margin: 0 0 var(--pi-space-2); }
  /* Attachments live above the text box, so pasted images/files are visible
     before the user starts editing the message body and never get hidden below
     the keyboard/action row on mobile. */
  /* The undelivered strip is its own box: with no style of its own it read
     as loose text continuing the transcript, so a failed message looked like
     something the agent had said. */
  .pending-prompts { display: grid; gap: var(--pi-space-2); box-sizing: border-box; margin: 0 var(--pi-bar-inset) var(--pi-space-3); padding: var(--pi-space-3) var(--pi-space-4); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-lg); background: color-mix(in srgb, var(--pi-warning) 8%, var(--pi-surface)); color: var(--pi-text); }
  .pending-prompt { display: flex; align-items: center; gap: var(--pi-space-3); min-width: 0; }
  .pending-prompt .pending-prompt-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pending-prompt .pending-prompt-state { flex: 0 0 auto; color: var(--pi-warning); font-size: var(--pi-text-xs); }
  .pending-prompt button { box-sizing: border-box; flex: 0 0 auto; min-height: var(--pi-control-height); padding: 0 var(--pi-space-4); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; }
  @media (pointer: coarse) { .pending-prompt button { min-height: var(--pi-control-height-touch); } }
  .attachments { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pi-space-4); margin: 0; padding: 0 0 var(--pi-space-1); }
  .attachment-chip { box-sizing: border-box; position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { box-sizing: border-box; display: grid; place-items: center; width: var(--pi-control-height-comfort); height: 26px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-xs); background: var(--pi-surface); color: var(--pi-muted); font: var(--pi-weight-bold) var(--pi-text-2xs)/1 var(--pi-font-ui, system-ui, sans-serif); line-height: inherit; letter-spacing: normal; }
  .attachment-file-name { position: absolute; right: var(--pi-space-2); bottom: var(--pi-space-1); left: var(--pi-space-2); overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-2xs); line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  /* A square badge in the corner, not a circle over the picture: the round
     44px control covered the thumbnail it was meant to remove (owner). The
     drawn box stays small and the thumb reaches it through a pseudo-element. */
  .attachment-remove { box-sizing: border-box; position: absolute; top: 0; right: 0; display: inline-grid; place-items: center; width: 16px; height: 16px; padding: 0; line-height: 1; border-radius: 0 var(--pi-radius-md) 0 var(--pi-radius-md); border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-2xs); cursor: pointer; }
  .attachment-remove::after { content: ""; position: absolute; inset: calc(-1 * var(--pi-space-6)); }
  /* A thumb is about 9mm wide. An 18px remove badge on a 56px thumbnail means
     the tap lands on the image instead, so on touch the badge grows and the
     chip grows with it rather than swallowing its own control. */
  @media (pointer: coarse) {
    .attachment-chip { width: 72px; height: 72px; }
    /* Still clamped: a touch-sized control must not outgrow a one-line field
       on a short viewport, which is exactly where the keyboard puts it. */
    button.editor-attach { width: min(var(--pi-control-height-comfort), calc(100% - 2 * var(--pi-space-3))); height: min(var(--pi-control-height-comfort), calc(100% - 2 * var(--pi-space-3))); }
  }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: var(--pi-text-xs); }
  /* Bordered controls, the owner's ruling against the ghosted round: on a
     phone an outline is what tells a glyph apart from decoration. The send
     action alone carries the accent. */
  button { font: var(--pi-text-xs) var(--pi-font-ui); line-height: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  button:not(:disabled):active { background: var(--pi-surface-hover); }
  button:disabled, textarea:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
  @media (max-width: 760px) {
    footer { gap: var(--pi-space-3); padding: var(--pi-space-3) var(--pi-bar-inset); }
    /* The action row is a bar: one bar tall, its 36px controls centred. */
    .actions { min-height: var(--pi-panel-header-height); gap: var(--pi-space-3); }
    .compact-status { flex: 1 1 220px; gap: var(--pi-space-3); }
    .select-model { max-width: min(58vw, 260px); }
    /* Vertical padding stacks on the 36px line-height and grew the row to 50;
       the bar centres its own controls. */
    button { padding: 0 var(--pi-space-4); }
  }
  @media (max-width: 430px) {
    .compact-status { flex-basis: 170px; font-size: var(--pi-text-2xs); }
    .select-model { max-width: 48vw; }
    button { padding: 0 var(--pi-space-4); }
    /* Narrow screens are phones: the touch targets get *bigger*, not smaller,
       and the caret keeps the line height it has on wide screens. The model
       chip rises with them so the toolbar stays one height. */
    .icon-button { width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); }
    .select-model { min-height: var(--pi-control-height-comfort); }
    .markdown-editor .cm-cursor { height: 1.4em !important; }
  }

  /* Coarse pointers keep the drawn 36px box the whole phone chrome shares
     (the owner measured the 44px squares as too big) and grow only what a
     finger can hit: a reach pseudo-element brings the target to the 44px
     floor without redrawing the control, as the message actions do. */
  @media (pointer: coarse) {
    .icon-button::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch, 44px)) / 2); }
    .attachment-remove { width: 18px; height: 18px; }
    .select-model { position: relative; min-height: var(--pi-control-height-comfort); }
    .select-model::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch, 44px)) / 2); }
    .select-thinking { min-width: var(--pi-control-height-comfort); }
    .compact-status > button { min-width: var(--pi-control-height-comfort); min-height: var(--pi-control-height-comfort); }
  }

  `;

type PendingAttachment = CapturedAttachment & { id: string };

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property() sessionId?: string;
  @property() cwd?: string;
  @property() machineId = "local";
  @property() projectId?: string;
  @property() workspaceId?: string;
  @property({ type: Boolean }) canSteer = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Boolean }) canStop = false;
  @property({ attribute: false }) status?: SessionStatus;
  @property({ type: Boolean }) sending = false;
  /**
   * Send handler. Resolving `false` means the message was not accepted, and the
   * composer puts its contents back rather than losing them.
   */
  /**
   * The composer as one line, for a reader who asked for the transcript.
   *
   * The styles and the up-arrow hint survived the wave that removed the property
   * ("the composer no longer collapses while a question is answered"), so nothing
   * could put the component in this state. Nothing sets it by default: the shell
   * does, when it has a reason to, and the harness can.
   */
  @property({ type: Boolean, reflect: true }) collapsed = false;

  /** Asked to come back, when the reader taps the collapsed composer. */
  @property({ attribute: false }) onExpand?: () => void;

  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery, replay?: SendReplay) => Promise<boolean | undefined> | boolean | undefined;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) composerContributions: readonly QualifiedComposerContribution[] = [];
  @property({ attribute: false }) onPluginNotice?: (message: string, severity: "info" | "warning" | "error") => void;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  @property({ attribute: false }) availableThinkingLevels: readonly string[] = [];
  @query(".markdown-editor") private editorHost?: HTMLDivElement;
  @query(".attachment-input") private attachmentInput?: HTMLInputElement;
  @query("dialog.attachment-zoom") private attachmentZoomDialog?: HTMLDialogElement;
  // `draft` is the live document text but is intentionally NOT reactive: it
  // changes on every keystroke and the visible text is owned by CodeMirror, not
  // by Lit's render. Re-rendering the surrounding template on each keystroke is
  // wasted work and, on iOS, can interrupt an in-progress touch gesture (the
  // long-press edit/paste callout). Only `currentInputMode` (shell vs. normal)
  // is reactive, since that is the only draft-derived value the template shows.
  private draft = "";
  /** Whether a draft has already been read back into this editor. */
  private hasRenderedOnce = false;
  @state() private currentInputMode: InputMode = { kind: "normal" };
  @state() private completions: CompletionItem[] = [];
  @state() private selectedIndex = 0;
  /** Whether the prompt-history sheet is open over the transcript. */
  @state() private historyOpen = false;
  /** This session's own user prompts: history that reached the server, so the
   * picker works on a device that never typed here. Most recent first. */
  @property({ attribute: false }) sessionPrompts: string[] = [];
  /**
   * Identities the transcript already draws. One message has one row, so the tray here
   * only speaks for an outbox entry nothing else shows - a message recovered after a
   * reload - and never repeats the bubble that is already saying "Sending".
   */
  @property({ attribute: false }) rowedMessageIds: ReadonlySet<string> = new Set();
  @state() private zoomedAttachment?: { src: string; alt: string } | undefined;
  @state() private attachments: PendingAttachment[] = [];
  @state() private attachmentError: string | undefined = undefined;
  /**
   * Files still being read into the composer. Attaching is asynchronous, and a
   * send inside that window used to go out as text alone, leaving the image to
   * follow as a second message with no body.
   */
  @state() private attachingCount = 0;
  private attachingSettled: Promise<void> = Promise.resolve();
  private attachmentSeq = 0;
  private requestVersion = 0;
  private historyIndex: number | undefined;
  private historyDraftBeforeBrowse = "";
  private editor: EditorView | undefined;
  /** The editor module; set exactly when `editor` is set. */
  private cm: ComposerEditorModule | undefined;
  private readonly mobilePromptEnterMedia = createMobilePromptEnterMedia();
  private explicitShiftKeyActive = false;

  protected override willUpdate(changed: PropertyValues<this>) {
    const sessionChanged = changed.has("sessionId");
    const machineChanged = changed.has("machineId");
    const hadRendered = this.hasRenderedOnce;
    if (!restoresDraftOnFirstRender({ hasRendered: hadRendered, sessionChanged, machineChanged })) return;
    this.hasRenderedOnce = true;
    const previousSessionId = sessionChanged ? changed.get("sessionId") : this.sessionId;
    const previousMachineId = machineChanged ? changed.get("machineId") : this.machineId;
    const previousKey = draftStorageKey(previousMachineId, previousSessionId);
    if (previousKey !== undefined && savesOutgoingDraft({ hasRendered: hadRendered })) saveDraft(previousKey, this.draft);
    const currentKey = draftStorageKey(this.machineId, this.sessionId);
    this.draft = currentKey !== undefined ? loadDraft(currentKey) : "";
    this.currentInputMode = inputModeForDraft(this.draft);
    this.completions = [];
    this.selectedIndex = 0;
    const switched = hadRendered && (sessionChanged || machineChanged);
    if (switched && previousKey !== undefined) holdComposerAttachments(previousKey, this.attachments);
    if (switched || !hadRendered) {
      const returning = currentKey === undefined ? [] : takeHeldComposerAttachments(currentKey).map((attachment) => this.withAttachmentId(attachment));
      this.attachments = [...returning, ...(switched ? [] : this.attachments)];
    }
    if (switched) {
      this.attachmentError = undefined;
      this.zoomedAttachment = undefined;
    }
    // The sheet lists one session's history; carried across a switch it would
    // answer for prompts the reader was never looking at.
    if (sessionChanged || machineChanged) this.historyOpen = false;
  }

  protected override shouldUpdate(changed: PropertyValues<this>): boolean {
    // Status updates churn once per token during streaming and hand us a fresh
    // object reference each time. When nothing else changed, only re-render if a
    // status field the template actually displays differs, so streaming does not
    // disturb the editor DOM (and any in-progress touch gesture survives).
    if (changed.has("status") && changed.size === 1) {
      return !sessionStatusRenderEqual(changed.get("status"), this.status);
    }
    return true;
  }

  @state() private pendingPrompts: PendingPrompt[] = [];

  override firstUpdated(): void {
    this.createEditor();
    this.pendingPrompts = this.pendingPromptsForSession();
    window.addEventListener("online", this.flushPendingPrompts);
    if (this.pendingPrompts.length > 0) this.flushPendingPrompts();
  }

  private readonly onOutboxChanged = (event: Event) => {
    const key = machineSessionKey(this.machineId, this.sessionId ?? "");
    if (key === "") return;
    const changed: unknown = event instanceof CustomEvent ? event.detail : undefined;
    if (changed !== undefined && changed !== key) return;
    this.pendingPrompts = this.pendingPromptsForSession();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.pendingPrompts = this.pendingPromptsForSession();
    window.addEventListener(OUTBOX_CHANGED_EVENT, this.onOutboxChanged);
  }

  protected override updated(changed: PropertyValues) {
    if (changed.has("sessionId") || changed.has("machineId")) {
      this.syncEditorDoc();
      // The strip must carry the scope it belongs to: rows loaded for the
      // previous session may not render - or act - against this one.
      this.pendingPrompts = this.pendingPromptsForSession();
      if (this.isConnected) this.flushPendingPrompts();
    }
    this.syncAttachmentZoomDialog();
  }

  override disconnectedCallback(): void {
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) holdComposerAttachments(key, this.attachments);
    window.removeEventListener("online", this.flushPendingPrompts);
    window.removeEventListener(OUTBOX_CHANGED_EVENT, this.onOutboxChanged);
    if (this.pendingRevealTimer !== undefined) {
      clearTimeout(this.pendingRevealTimer);
      this.pendingRevealTimer = undefined;
    }
    this.editor?.destroy();
    this.editor = undefined;
    super.disconnectedCallback();
  }

  override render() {
    const shellInputMode = this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const queuesInput = this.canSteer || this.isCompacting;
    return html`
      <footer class=${shellMode ? "shell-mode" : ""} @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }} @dragover=${(event: DragEvent) => { this.handleDragOver(event); }} @drop=${(event: DragEvent) => { void this.handleDrop(event); }}>
        <input class="attachment-input" type="file" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
        ${this.renderPendingPrompts()}
        ${this.renderAttachments()}
        ${this.collapsed ? this.renderCollapsedComposer() : null}
        <div class="editor-wrap" ?hidden=${this.collapsed}>
          ${shellMode ? html`<div class="mode-hint">Shell command${shellInputMode.excludeFromContext ? " · excluded from context" : ""}</div>` : null}
          ${this.renderComposerContributionStatus()}
          ${this.isCompacting && !shellMode ? html`<div class="mode-hint">Compacting history · message will be queued</div>` : null}
          <div class="editor-box">
            <div
              class="markdown-editor"
              aria-label="Message pi"
            ></div>
            <button class="editor-attach icon-button" title="Attach files" aria-label="Attach files" @click=${() => { this.attachmentInput?.click(); }}>${renderAttachIcon()}</button>
          </div>
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        <div class="actions">
          ${this.renderComposerContributions("leading")}
          ${this.renderCompactStatus()}
          ${this.renderHistoryButton()}
          ${this.renderComposerContributions("trailing")}
          <button class="icon-button send-button" title=${queuesInput ? "Steer — joins the current turn at the next safe point" : "Send message"} aria-label=${queuesInput ? "Steer current response (queued if busy)" : "Send message"} @click=${() => { this.send(this.canSteer ? "steer" : "followUp"); }}>${this.canSteer ? renderSteerIcon() : queuesInput ? renderQueueIcon() : renderSendIcon()}</button>
          <button class="icon-button stop-button" ?disabled=${!this.canStop} title=${this.canStop ? "Stop current work and clear queued messages" : "Nothing running"} aria-label="Stop current work" @click=${() => this.onStop?.()}>${renderStopIcon()}</button>
        </div>
      </footer>
      ${this.renderAttachmentZoom()}
      ${this.renderHistoryPanel()}
    `;
  }


  /** The start of the unsent draft, so a collapsed composer is not a black box. */
  private renderCollapsedComposer() {
    return html`
      <button
        type="button"
        class="expand-composer"
        aria-label="Message pi"
        @click=${() => { this.expandComposer(); }}
      >
        <span class="expand-composer-label">Message pi…</span>
        ${this.draftPreview === "" ? null : html`<span class="expand-composer-draft" dir="auto">${this.draftPreview}</span>`}
        <span class="expand-composer-hint">${renderUpIcon()}</span>
      </button>
    `;
  }

  /** Back to the editor, caret where the reader was. */
  private expandComposer(): void {
    this.onExpand?.();
    this.collapsed = false;
    void this.updateComplete.then(() => { this.editor?.focus(); });
  }

  private get draftPreview(): string {
    const text = (this.editor?.state.doc.toString() ?? this.draft).trim().replace(/\s+/gu, " ");
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }

  focusInput() {
    this.editor?.focus();
  }

  /**
   * Take a message back into the composer: its text, plus its images as fresh pending
   * attachments, without losing anything the reader already has there.
   *
   * Every "put it back" path - Discard, recall, stop, edit and send again - lands here, so
   * none of them can overwrite a half-typed draft (see composerTakeBack).
   */
  takeBack(prompt: { text: string; attachments: readonly PromptAttachment[] }): void {
    const current = this.editor?.state.doc.toString() ?? this.draft;
    this.attachmentError = undefined;
    this.attachments = [...this.attachments, ...this.restoredImages(prompt.attachments)];
    this.replaceText(joinTakenBack(current, prompt.text));
    this.focusInput();
  }

  private restoredImages(attachments: readonly PromptAttachment[]) {
    return attachments
      .filter((attachment): attachment is Extract<PromptAttachment, { kind: "image" }> => attachment.kind === "image")
      .map((attachment, index) => {
        this.attachmentSeq += 1;
        return {
          id: `restored-${String(this.attachmentSeq)}`,
          kind: "image" as const,
          name: attachment.name ?? `image-${String(index + 1)}`,
          mimeType: attachment.mimeType,
          data: attachment.data,
          size: Math.floor((attachment.data.length * 3) / 4),
        };
      });
  }

  /**
   * An extension's `pasteToEditor`: the text goes in at the caret, over a selection, as a paste
   * does. Before the editor is drawn there is no caret, so the text joins the end of the draft.
   */
  pasteText(text: string): void {
    const editor = this.editor;
    const cm = this.cm;
    if (editor === undefined || cm === undefined) {
      this.replaceText(`${this.draft}${text}`);
      return;
    }
    const { from, to } = editor.state.selection.main;
    editor.dispatch({ changes: { from, to, insert: text }, selection: cm.cursorAt(from + text.length) });
  }

  replaceText(text: string): void {
    this.draft = text;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, text);

    const editor = this.editor;
    if (editor !== undefined && this.cm !== undefined) {
      const current = editor.state.doc.toString();
      editor.dispatch({
        ...(current === text ? {} : { changes: { from: 0, to: current.length, insert: text } }),
        selection: this.cm.cursorAt(text.length),
      });
    }

    // Invalidate completion requests started for either the previous document or
    // the replacement dispatch, then return the editor to a clean completion state.
    this.requestVersion += 1;
    this.currentInputMode = inputModeForDraft(text);
    this.completions = [];
    this.selectedIndex = 0;
  }

  /** Get the underlying CM6 EditorView, or undefined if not yet mounted. */
  get view(): EditorView | undefined {
    return this.editor;
  }

  private renderCompactStatus() {
    const status = this.status;
    if (status === undefined) return null;
    const model = status.model?.id ?? "no model";
    const provider = status.model?.provider !== undefined && status.model.provider !== "" ? `${status.model.provider}/` : "";
    return html`
      <div class="compact-status" aria-label="Session status">
        <button class="select-model" title=${`Select model: ${provider}${model}`} @click=${() => this.onSelectModel?.()}><span class="select-model-label">${provider === "" ? null : html`<span class="select-model-provider">${provider}</span>`}<span class="select-model-id">${model}</span></span></button>
        <button class="select-thinking icon-button" title=${`Thinking level: ${thinkingLevelLabel(status.thinkingLevel)}`} aria-label=${`Thinking level: ${thinkingLevelLabel(status.thinkingLevel)}`} @click=${() => this.onSelectThinking?.()}>${renderThinkingGauge(thinkingGauge(status.thinkingLevel, this.availableThinkingLevels))}</button>
      </div>
    `;
  }

  private pendingRevealTimer: ReturnType<typeof setTimeout> | undefined;
  /** The sends this composer is still waiting on, by client message id. */
  private readonly outboxInFlight = new Set<string>();
  private sendOrder: Promise<void> = Promise.resolve();
  private sendsWaiting = 0;
  private replayQueued = false;

  /**
   * Whether storage holds anything for this session.
   *
   * Read from storage rather than the in-memory list: the caller uses it as the
   * gate for walking the transcript, and an entry written by another tab (or by a
   * restored record) has to be seen too. Cheap - a tiny array - so the render path
   * can afford it, while the walk it guards cannot be done every render.
   */
  hasStoredOutbox(): boolean {
    const key = this.outboxKey();
    return key !== "" && loadPendingPrompts(key).length > 0;
  }

  /**
   * Retire the rows the transcript already shows.
   *
   * Called with the settled identities rather than deciding here: the transcript
   * belongs to the chat and the identity rule belongs to the register. A row
   * dropped this way is not unsent any more, whatever the send call reported -
   * the POST timing out while the daemon accepted is what put "Unsent / Retry"
   * under a running turn, with the message visible in the transcript above it.
   */
  settleOutbox(delivered: ReadonlySet<string>): void {
    if (delivered.size === 0) return;
    const key = this.outboxKey();
    if (key === "") return;
    const stored = loadPendingPrompts(key);
    if (stored.length === 0) return;
    const ids = stored.map((prompt) => prompt.clientMessageId).filter((id): id is string => typeof id === "string" && id !== "");
    const settlement = settleOutbox(ids, (id) => delivered.has(id));
    if (settlement.drop.length === 0) return;
    for (const id of settlement.drop) {
      forgetPendingPrompt(key, id);
      this.outboxInFlight.delete(id);
    }
    this.pendingPrompts = this.pendingPromptsForSession();
  }

  private outboxKey(): string {
    return machineSessionKey(this.machineId, this.sessionId ?? "");
  }

  private renderPendingPrompts() {
    const now = Date.now();
    const lingering = this.pendingPrompts.filter((prompt) => !(now - Date.parse(prompt.at) <= 4000) && !this.rowedMessageIds.has(prompt.clientMessageId ?? ""));
    if (lingering.length === 0) {
      const rowless = this.pendingPrompts.some((prompt) => !this.rowedMessageIds.has(prompt.clientMessageId ?? ""));
      if (rowless && this.pendingRevealTimer === undefined) {
        this.pendingRevealTimer = setTimeout(() => { this.pendingRevealTimer = undefined; this.requestUpdate(); }, 4200);
      }
      return null;
    }
    return html`
      <div class="pending-prompts" role="status" aria-label="Messages not delivered">
        ${lingering.map((prompt) => {
          // Per message, not the composer's global flag: an in-flight row and a
          // failed one sit side by side and must not borrow each other's state.
          const actions = pendingPromptActions(trayState(prompt, this.outboxInFlight.has(prompt.clientMessageId ?? "")));
          return html`
            <div class="pending-prompt">
              <span class="pending-prompt-text">${prompt.text.slice(0, 80)}${prompt.text.length > 80 ? "…" : ""}</span>
              <span class="pending-prompt-state">${actions.label}</span>
              ${actions.retry ? html`<button type="button" @click=${() => { this.retryOutbox(prompt.clientMessageId ?? ""); }}>Retry</button>` : nothing}
              ${actions.discard ? html`<button type="button" class="pending-prompt-discard" @click=${() => { this.discardPendingPrompt(prompt); }}>Discard</button>` : nothing}
            </div>
          `;
        })}
      </div>
    `;
  }

  private discardPendingPrompt(prompt: PendingPrompt): void {
    const key = machineSessionKey(this.machineId, this.sessionId ?? "");
    if (key === "" || prompt.clientMessageId === undefined) return;
    forgetPendingPrompt(key, prompt.clientMessageId);
    this.outboxInFlight.delete(prompt.clientMessageId);
    this.pendingPrompts = this.pendingPromptsForSession();
    this.takeBack({ text: prompt.text, attachments: prompt.attachments ?? [] });
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    return html`
      <div class="attachments" aria-label="Pending attachments">
        ${this.attachments.map((attachment) => html`
          <div class=${`attachment-chip ${isInlinePromptAttachment(attachment) ? "attachment-chip-image" : "attachment-chip-file"}`} title=${attachment.name}>
            ${this.renderAttachmentPreview(attachment)}
            <button type="button" class="attachment-remove" title="Remove attachment" aria-label=${`Remove ${attachment.name}`} @click=${() => { this.removeAttachment(attachment.id); }}>${renderCrossIcon()}</button>
          </div>
        `)}
        ${this.attachmentError !== undefined ? html`<div class="attachment-error">${this.attachmentError}</div>` : null}
      </div>
    `;
  }

  private renderAttachmentPreview(attachment: PendingAttachment) {
    if (isInlinePromptAttachment(attachment)) {
      const src = `data:${attachment.mimeType};base64,${attachment.data}`;
      return html`<img
        src=${src}
        alt=${attachment.name}
        role="button"
        tabindex="0"
        title="Click to enlarge"
        @click=${() => { this.openAttachmentZoom(src, attachment.name); }}
        @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.openAttachmentZoom(src, attachment.name); } }}
      />`;
    }
    return html`
      <div class="attachment-file-preview" aria-hidden="true">${fileExtensionLabel(attachment.name)}</div>
      <span class="attachment-file-name">${attachment.name}</span>
    `;
  }

  private removeAttachment(id: string) {
    this.attachments = this.attachments.filter((attachment) => attachment.id !== id);
  }

  private readonly openAttachmentZoom = (src: string, alt: string): void => {
    this.zoomedAttachment = { src, alt };
  };

  private readonly closeAttachmentZoom = (): void => {
    this.zoomedAttachment = undefined;
  };

  /** A tap anywhere closes the picture, the image included. */
  private readonly onAttachmentZoomDialogClick = (): void => {
    this.closeAttachmentZoom();
  };

  private syncAttachmentZoomDialog(): void {
    const dialog = this.attachmentZoomDialog;
    // Truthy check on purpose: the @query handle is null until the element
    // first renders (its declared type says undefined, but Lit's decorator
    // returns null when nothing matches) - the undefined-only guard let that
    // null through and the tap crashed the update cycle.
    if (!dialog) return;
    if (this.zoomedAttachment !== undefined) {
      // A pending attachment lives only in the composer, so there is exactly
      // one modal to keep in step: showModal for the native top layer (Esc and
      // backdrop behaviour included), and focus a labelled control instead of
      // the bare dialog, which nothing would announce.
      try {
        if (!dialog.open) dialog.showModal();
      } catch {
        this.zoomedAttachment = undefined;
        return;
      }
      dialog.focus();
      return;
    }
    if (dialog.open) dialog.close();
  }

  private renderAttachmentZoom() {
    const zoomed = this.zoomedAttachment;
    return html`
      <dialog class="attachment-zoom" tabindex="-1" aria-label="Image, tap to close" @click=${this.onAttachmentZoomDialogClick} @close=${this.closeAttachmentZoom} @cancel=${this.closeAttachmentZoom}>
        ${zoomed === undefined ? null : html`
          <img class="attachment-zoom-full" src=${zoomed.src} alt=${zoomed.alt} />
        `}
      </dialog>
    `;
  }

  /** Files dropped on the chat around the composer (`fileDrop.ts`), taken as if dropped here. */
  attachFiles(files: readonly File[]): Promise<void> {
    return this.addAttachmentFiles([...files]);
  }

  private async handlePaste(event: ClipboardEvent) {
    const files = filesFromDataTransfer(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private handleDragOver(event: DragEvent) {
    if (event.dataTransfer === null) return;
    if (dataTransferHasFiles(event.dataTransfer)) event.preventDefault();
  }

  private async handleDrop(event: DragEvent) {
    const files = filesFromDataTransfer(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    await this.addAttachmentFiles(files);
  }

  private async handleFileInput(event: Event) {
    if (!(event.target instanceof HTMLInputElement) || event.target.files === null) return;
    const files = Array.from(event.target.files);
    event.target.value = "";
    await this.addAttachmentFiles(files);
  }

  private async addAttachmentFiles(files: File[]) {
    this.attachmentError = undefined;
    this.attachingCount += 1;
    const scopeKey = machineSessionKey(this.machineId, this.sessionId ?? "");
    const capture = capturePromptAttachments(files, readFileAsBase64);
    this.attachingSettled = this.attachingSettled
      .then(async () => { await capture; })
      .catch(() => undefined);
    let captured: Awaited<typeof capture>;
    try {
      captured = await capture;
    } finally {
      this.attachingCount -= 1;
    }
    // Capture is async: after a session switch the result belongs to the
    // session it was attached in, not the composer now showing another.
    if (machineSessionKey(this.machineId, this.sessionId ?? "") !== scopeKey) {
      addToHeldComposerAttachments(scopeKey, captured.attachments);
      return;
    }
    const { attachments, error } = captured;
    if (attachments.length > 0) {
      this.attachments = [...this.attachments, ...attachments.map((attachment) => this.withAttachmentId(attachment))];
    }
    if (error !== undefined) this.attachmentError = error;
  }

  /** A fresh id from this composer: held attachments may come from an earlier composer whose ids collide. */
  private withAttachmentId(attachment: CapturedAttachment): PendingAttachment {
    return { ...attachment, id: `attachment-${String(++this.attachmentSeq)}` };
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => pendingToPromptAttachment(attachment));
  }

  private renderHistoryButton() {
    const key = draftStorageKey(this.machineId, this.sessionId);
    const localCount = key === undefined ? 0 : loadPromptHistory(key).length;
    if (localCount === 0 && this.sessionPrompts.length === 0) return null;
    return html`
      <button
        class="editor-history icon-button"
        type="button"
        title="Reuse an earlier prompt"
        aria-label="Reuse an earlier prompt"
        @click=${() => { this.openPromptHistoryPicker(); }}
      ><svg class="prompt-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path></svg></button>
    `;
  }

  /** The searchable history sheet, anchored above the composer so it never
   * covers the editor it fills. */
  private renderHistoryPanel() {
    if (!this.historyOpen) return null;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key === undefined) return null;
    return html`
      <prompt-history-panel
        .sessionKey=${key}
        .sessionPrompts=${this.sessionPrompts}
        .onPick=${(text: string) => { this.restoreHistoryEntry(text); }}
        .onClose=${() => { this.historyOpen = false; }}
      ></prompt-history-panel>
    `;
  }

  /** Fill the composer from a history pick and get out of the way. */
  private restoreHistoryEntry(text: string): void {
    this.historyIndex = undefined;
    this.historyOpen = false;
    this.replaceText(text);
    this.focusInput();
  }

  /**
   * Append dictated text to whatever is already typed rather than replacing it.
   *
   * Public because it is the seam dictation lands through, and it is the
   * behaviour worth asserting: a transcript must never wipe a half-written
   * message.
   */
  private composerContributionContext(): ComposerRuntimeContext {
    return {
      sessionId: this.sessionId,
      machineId: this.machineId,
      draft: this.editor?.state.doc.toString() ?? this.draft,
      busy: this.sending,
      insertText: (text: string) => { this.insertDictatedText(text); },
      replaceDraft: (text: string) => { this.replaceText(text); },
      notify: (message: string, severity: "info" | "warning" | "error") => { this.onPluginNotice?.(message, severity); },
      requestUpdate: () => { this.requestUpdate(); },
    };
  }

  private renderComposerContributions(slot: ComposerSlot) {
    const context = this.composerContributionContext();
    const entries = this.composerContributions.filter((entry) => entry.slot === slot && (entry.available?.(context) ?? true));
    if (entries.length === 0) return null;
    return html`${entries.map((entry) => {
      const enabled = entry.enabled?.(context) ?? true;
      const reason = enabled ? undefined : entry.disabledReason?.(context);
      return html`<button
        type="button"
        class="icon-button"
        ?disabled=${!enabled}
        title=${reason ?? entry.title}
        aria-label=${entry.title}
        @click=${() => { void entry.run(this.composerContributionContext()); }}
      >${entry.icon ?? entry.title}</button>`;
    })}`;
  }

  private renderComposerContributionStatus() {
    const context = this.composerContributionContext();
    const lines = this.composerContributions.flatMap((entry) => {
      if (entry.available?.(context) === false) return [];
      const status = entry.status?.(context);
      return status === undefined ? [] : [{ id: entry.id, status }];
    });
    if (lines.length === 0) return null;
    return html`${lines.map((line) => html`<div class=${line.status.severity === "problem" ? "mode-hint mode-hint-problem" : "mode-hint"}>${line.status.text}</div>`)}`;
  }

  insertDictatedText(text: string): void {
    const current = this.editor?.state.doc.toString() ?? this.draft;
    const separator = current === "" || current.endsWith(" ") || current.endsWith("\n") ? "" : " ";
    this.replaceText(`${current}${separator}${text}`);
  }

  private effectiveAttachmentDelivery(): PromptAttachmentDelivery {
    // Keep the UI simple on mobile: images ride inline, everything else falls
    // back to workspace files automatically.
    return effectivePromptAttachmentDelivery("inline", this.attachments);
  }

  /**
   * The editor ships with the page (owner, 2026-10-06). It used to arrive by a
   * dynamic import when the composer mounted; one failed fetch of that file left
   * the tab with no input until a reload, because Chrome remembers a failed
   * module import and fails every later one for the same file.
   */
  private createEditor() {
    if (!this.editorHost || this.editor !== undefined) return;
    const view = composerEditor.createComposerEditor({
      parent: this.editorHost,
      doc: this.draft,
      placeholderText: composerPlaceholder(),
      contentAttributesFor: (leadingText) => inputAssistanceContentAttributes(leadingText),
      onDocChanged: (text) => { this.updateDraft(text); },
      onKeyUp: (event) => this.handleEditorKeyUp(event),
      onBlur: () => { this.resetEditorModifierState(); },
      onKeyDown: (event, view) => this.handleEditorKeyDown(event, view),
      onArrow: (view, direction) => this.handleEditorArrow(view, direction),
      onEscape: () => this.closeCompletions(),
      onTab: (view) => this.handleEditorTab(view),
    });
    this.cm = composerEditor;
    this.editor = view;
  }

  private syncEditorDoc() {
    const editor = this.editor;
    const cm = this.cm;
    if (!editor || cm === undefined) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: cm.cursorAt(this.draft.length),
    });
  }

  private updateDraft(value: string) {
    this.draft = value;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) saveDraft(key, this.draft);
    const nextInputMode = inputModeForDraft(this.draft);
    if (!inputModesEqual(nextInputMode, this.currentInputMode)) this.currentInputMode = nextInputMode;
    void this.refreshCompletions();
  }

  private async refreshCompletions() {
    const trigger = this.currentTrigger();
    const version = ++this.requestVersion;
    this.selectedIndex = 0;
    if (trigger === undefined) {
      this.completions = [];
      return;
    }
    if (trigger.kind === "command" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const commands = await api.commands({ id: this.sessionId, cwd: this.cwd }, this.machineId).catch(emptySlashCommands);
      if (version !== this.requestVersion) return;
      this.completions = commands
        .filter((command) => command.name.toLowerCase().includes(trigger.query.toLowerCase()))
        .slice(0, 12)
        .map((command) => ({
          kind: "command",
          replaceFrom: trigger.from,
          replaceTo: trigger.to,
          insertText: `/${command.name}`,
          detail: command.source,
          ...(command.description === undefined ? {} : { description: command.description }),
        }));
    } else if (trigger.kind === "file" && this.projectId !== undefined && this.workspaceId !== undefined) {
      const files = await api.files(trigger.query, { scope: trigger.fileScope, machineId: this.machineId, projectId: this.projectId, workspaceId: this.workspaceId }).catch(emptyFileSuggestions);
      if (version !== this.requestVersion) return;
      this.completions = files
        .slice(0, 12)
        .map((file) => {
          const insertText = fileCompletionInsertText(file.path, trigger.quoted === true, file.path.endsWith("/") ? trigger.allPrefix : undefined);
          return {
            kind: "file",
            replaceFrom: trigger.from,
            replaceTo: trigger.to,
            insertText,
            detail: file.kind,
            ...(file.path.endsWith("/") && insertText.endsWith("\"") ? { cursorOffset: insertText.length - 1 } : {}),
          };
        });
    } else if (trigger.kind === "model" && this.sessionId !== undefined && this.sessionId !== "" && this.cwd !== undefined && this.cwd !== "") {
      const models = await api.models({ id: this.sessionId, cwd: this.cwd }, this.machineId).then((response) => response.models).catch(emptySessionModels);
      if (version !== this.requestVersion) return;
      this.completions = modelCompletionChoices(models, trigger.query).map((choice) => ({
        kind: "model",
        replaceFrom: trigger.from,
        replaceTo: trigger.to,
        ...choice,
      }));
    }
  }

  private currentTrigger(): PromptCompletionTrigger | undefined {
    return detectPromptCompletionTrigger(this.draft, this.editor?.state.selection.main.head ?? this.draft.length);
  }

  private moveCompletion(delta: number): boolean {
    if (!this.completions.length) return false;
    this.selectedIndex = (this.selectedIndex + delta + this.completions.length) % this.completions.length;
    return true;
  }

  private handleEditorArrow(view: EditorView, direction: HistoryDirection): boolean {
    // In a completion list, Up moves toward the top of the list; in history, Up
    // moves further back in time. The two are opposite directions through an
    // array, so they are named rather than shared as a raw step.
    if (this.completions.length) return this.moveCompletion(direction === "older" ? -1 : 1);
    return this.browsePromptHistory(view, historyIndexStep(direction));
  }

  private browsePromptHistory(view: EditorView, delta: 1 | -1): boolean {
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key === undefined) return false;
    const history = loadPromptHistory(key);
    if (history.length === 0) return false;
    const cursor = view.state.selection.main.head;
    const selectionEmpty = view.state.selection.main.empty;
    const doc = view.state.doc.toString();
    if (this.historyIndex === undefined) {
      if (!(selectionEmpty && cursor === doc.length && doc.trim() === "")) return false;
      this.historyDraftBeforeBrowse = doc;
      this.historyIndex = 0;
    } else {
      const nextIndex = this.historyIndex + delta;
      if (nextIndex < 0) return true;
      if (nextIndex >= history.length) {
        this.historyIndex = undefined;
        this.replaceText(this.historyDraftBeforeBrowse);
        return true;
      }
      this.historyIndex = nextIndex;
    }
    const next = history[this.historyIndex] ?? this.historyDraftBeforeBrowse;
    this.replaceText(next);
    return true;
  }

  private closeCompletions(): boolean {
    if (!this.completions.length) return false;
    this.completions = [];
    return true;
  }

  private handleEditorKeyDown(event: KeyboardEvent, view: EditorView): boolean {
    if (event.key === "Shift") {
      this.explicitShiftKeyActive = true;
      return false;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      return this.openPromptHistoryPicker();
    }
    if (event.key !== "Enter") {
      this.explicitShiftKeyActive = false;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") this.historyIndex = undefined;
      return false;
    }
    if (event.defaultPrevented || keyBelongsToInputMethod(event) || view.composing) return false;

    const shiftKey = shouldUsePromptEnterShiftShortcut(event.shiftKey, this.explicitShiftKeyActive, this.mobilePromptEnterMedia);
    this.explicitShiftKeyActive = false;
    return this.handleEditorEnter(view, shiftKey);
  }

  private handleEditorKeyUp(event: KeyboardEvent): boolean {
    if (event.key === "Shift") this.explicitShiftKeyActive = false;
    return false;
  }

  private resetEditorModifierState(): boolean {
    this.explicitShiftKeyActive = false;
    return false;
  }

  private handleEditorEnter(view: EditorView, shiftKey: boolean): boolean {
    if (!shiftKey && this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    if (!shouldSendPromptOnEnterShortcut(shiftKey, this.mobilePromptEnterMedia, readPromptEnterPreference())) {
      return this.cm?.composerNewline(view) ?? false;
    }
    // Enter sends as steer while the agent is mid-turn (the pi TUI default):
    // the message interrupts the current work at the next safe point. While
    // compacting the only queueable mode is follow-up.
    this.send(this.canSteer ? "steer" : "followUp");
    return true;
  }

  private handleEditorTab(view: EditorView): boolean {
    if (this.completions.length) {
      const completion = this.completions[this.selectedIndex];
      if (completion !== undefined) this.pick(completion);
      return true;
    }
    const trigger = this.currentTrigger();
    if (trigger?.kind === "file") {
      void this.refreshCompletions();
      return true;
    }
    return this.cm?.composerIndent(view) ?? false;
  }

  private pick(item: CompletionItem) {
    const editor = this.editor;
    if (!editor) return;
    const suffix = item.kind === "file" && (item.insertText.endsWith("/") || item.cursorOffset !== undefined) ? "" : " ";
    const cursor = item.replaceFrom + (item.cursorOffset ?? item.insertText.length) + suffix.length;
    const replaceTo = item.insertText.endsWith("\"") && this.draft.slice(item.replaceTo).startsWith("\"") ? item.replaceTo + 1 : item.replaceTo;
    editor.dispatch({
      changes: { from: item.replaceFrom, to: replaceTo, insert: `${item.insertText}${suffix}` },
      selection: this.cm !== undefined ? this.cm.cursorAt(cursor) : undefined,
      scrollIntoView: true,
    });
    this.completions = [];
  }

  /**
   * Open the searchable history sheet. Empty handed is a no-op: the button is
   * already hidden then, and the shortcut must not open an empty room.
   */
  private openPromptHistoryPicker(): boolean {
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key === undefined) return false;
    if (searchPromptHistory(key, "", this.sessionPrompts).length === 0) return false;
    this.historyOpen = true;
    return true;
  }

  /**
   * The records waiting on the reader. A record the daemon holds stays on file until the agent
   * takes it, so a refusal can still make it retryable, but it is not the tray's to show.
   */
  private pendingPromptsForSession(): PendingPrompt[] {
    const key = machineSessionKey(this.machineId, this.sessionId ?? "");
    return key === "" ? [] : loadPendingPrompts(key).filter((prompt) => outgoingStopped(prompt.state));
  }

  private flushInFlight = false;

  /**
   * Re-send stored prompts one at a time, deleting exactly the accepted ids.
   * Reviewers proved the previous clear-and-replay wiped anything written to
   * the store while the flush awaited the network - a concurrent send, or a
   * Discard, which the replay then resurrected. Per-id deletion cannot touch
   * entries this loop never handled, and a membership re-check before each
   * send honors a Discard that happened mid-flight. Acceptance uses the same
   * contract as the direct path: only an explicit false is a refusal.
   */
  /**
   * Replay one message from the outbox under its own identity, as its row's Retry asks.
   * When the replay cannot start - offline, another replay still running, or the message no
   * longer held - the reader is told which, instead of pressing a button that does nothing.
   */
  retryOutbox(clientMessageId: string): void {
    const key = this.outboxKey();
    const held = loadPendingPrompts(key).some((prompt) => prompt.clientMessageId === clientMessageId);
    const blocked = retryBlocked(navigator.onLine, this.flushInFlight, held);
    if (blocked !== undefined) {
      this.onPluginNotice?.(RETRY_BLOCKED_NOTICE[blocked], "warning");
      return;
    }
    this.replayOutbox(clientMessageId);
  }

  private readonly flushPendingPrompts = (): void => {
    this.replayOutbox(undefined);
  };

  /**
   * Replay the outbox as one step of the composer's send chain, so a replay and a new send can
   * never overtake each other: kept records go before anything typed after them. A replay
   * already queued and not yet started covers every record present when it runs, so a second
   * one is not queued behind it.
   */
  private replayOutbox(only: string | undefined): void {
    if (this.onSend === undefined) return;
    if (only === undefined) {
      if (this.replayQueued) return;
      this.replayQueued = true;
    }
    this.enqueueSend(async () => {
      if (only === undefined) this.replayQueued = false;
      await this.replayRecords(only);
    });
  }

  /**
   * Send the records the composer's current session holds, in stored order, reading them when
   * this step's turn comes rather than when it was queued. A record whose own send is still
   * waiting in the chain is skipped: its own step sends it.
   */
  private async replayRecords(only: string | undefined): Promise<void> {
    const send = this.onSend;
    const key = this.outboxKey();
    if (!navigator.onLine || !this.isConnected || send === undefined || key === "") return;
    const scope: SendScope = { machineId: this.machineId, sessionId: this.sessionId ?? "" };
    this.flushInFlight = true;
    try {
      for (const prompt of loadPendingPrompts(key).filter((entry) => replaysRecord(entry, only))) {
        const id = prompt.clientMessageId;
        if (id === undefined || this.outboxInFlight.has(id)) continue;
        if (!this.stillShows(key)) return;
        if (!loadPendingPrompts(key).some((entry) => entry.clientMessageId === id && replaysRecord(entry, only))) continue;
        this.outboxInFlight.add(id);
        if (only !== undefined && prompt.refused === true) {
          const retried: PendingPrompt = { ...prompt };
          delete retried.refused;
          savePendingPrompt(key, retried);
        }
        try {
          const accepted = await send(prompt.text, prompt.behavior, prompt.attachments, recordedDelivery(prompt), { clientMessageId: id, scope, sentAt: prompt.at });
          if (accepted !== false) reserveAcceptedPrompt(key, id);
          else if (prompt.refused === true && loadPendingPrompts(key).some((entry) => entry.clientMessageId === id)) savePendingPrompt(key, prompt);
        } catch (failure) {
          const left = unansweredBytesLeft(failure);
          if (left !== undefined) markUnansweredPrompt(key, id, left);
          continue;
        } finally {
          this.outboxInFlight.delete(id);
        }
      }
    } finally {
      this.flushInFlight = false;
      this.pendingPrompts = this.pendingPromptsForSession();
    }
  }

  /** Whether this composer is still on the page and showing the session an outbox key names. */
  private stillShows(key: string): boolean {
    return this.isConnected && this.outboxKey() === key;
  }

  /**
   * Run one outbound step after every earlier one from this composer; the first starts at once.
   * The chain's tail is in place before a first step starts, so a step that queues another
   * from inside itself queues it behind itself rather than beside it.
   */
  private enqueueSend(step: () => Promise<void>): void {
    this.sendsWaiting += 1;
    const run = async (): Promise<void> => {
      try {
        await step();
      } finally {
        this.sendsWaiting -= 1;
      }
    };
    if (this.sendsWaiting > 1) {
      this.sendOrder = this.sendOrder.then(run, run);
      return;
    }
    let settled: () => void = () => undefined;
    this.sendOrder = new Promise<void>((resolve) => { settled = resolve; });
    void run().then(settled, settled);
  }

  /**
   * Send the composer's contents. Sends from one composer reach the daemon in the order they
   * were made: each is recorded in the outbox at once - durable, and shown as sending - and
   * handed over only after the previous one settled, so two in flight cannot be reordered by
   * the network. A send is never swallowed because another is uploading; it waits its turn.
   */
  private send(streamingBehavior?: "steer" | "followUp") {
    // A file still being read belongs to this message. Sending without it is
    // how one submission became a text message plus a bodiless image.
    if (this.attachingCount > 0) {
      void this.attachingSettled.then(() => { this.send(streamingBehavior); });
      return;
    }
    const text = this.draft.trim();
    const pending = this.attachments;
    if (text === "" && pending.length === 0) return;
    const behavior = this.canSteer || this.isCompacting ? streamingBehavior : undefined;
    const attachments = pending.length > 0 ? this.currentAttachments() : undefined;
    const delivery = this.effectiveAttachmentDelivery();
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined && text !== "") rememberPromptHistory(key, text);
    // Cleared optimistically so the composer feels immediate, but the contents
    // are kept so a rejected send can put them back. Losing a long prompt and
    // its images to a dropped connection is the kind of failure that makes
    // people distrust the app.
    const restorable = { text: this.draft, attachments: pending };
    this.resetComposer();
    const outgoing = this.recordOutgoing(text, behavior, attachments, delivery);
    this.enqueueSend(() => this.deliverAndRestoreOnFailure(text, behavior, attachments, delivery, restorable, outgoing));
  }

  /** Mint the message's identity and write its outbox record, before it waits for its turn. */
  private recordOutgoing(text: string, behavior: "steer" | "followUp" | undefined, attachments: PromptAttachment[] | undefined, delivery: PromptAttachmentDelivery): OutgoingSend {
    const outboxKey = machineSessionKey(this.machineId, this.sessionId ?? "");
    const outboxId = newClientMessageId();
    const sentAt = new Date().toISOString();
    const carried = attachments === undefined || attachments.length === 0 ? undefined : attachments;
    if (outboxKey !== "") {
      savePendingPrompt(outboxKey, { text, ...(behavior === undefined ? {} : { behavior }), clientMessageId: outboxId, ...(carried === undefined ? {} : { attachments: carried, delivery }), at: sentAt });
      this.pendingPrompts = this.pendingPromptsForSession();
    }
    this.outboxInFlight.add(outboxId);
    return { outboxKey, outboxId, sentAt, scope: { machineId: this.machineId, sessionId: this.sessionId ?? "" }, writtenOnPage: this.isConnected, text, behavior, attachments, delivery };
  }

  /**
   * Hand the prompt to the controller and, if it reports failure, restore what
   * the composer was holding.
   *
   * Only restores when the composer is still empty: anything typed since is the
   * user's newer intent, and overwriting it would be a second kind of loss.
   */
  private async deliverAndRestoreOnFailure(
    text: string,
    behavior: "steer" | "followUp" | undefined,
    attachments: PromptAttachment[] | undefined,
    delivery: PromptAttachmentDelivery,
    restorable: { text: string; attachments: PendingAttachment[] },
    outgoing: OutgoingSend = this.recordOutgoing(text, behavior, attachments, delivery),
  ): Promise<void> {
    const { outboxKey, outboxId, scope, sentAt } = outgoing;
    const scopeKey = outboxKey;
    const keepForItsSession = (): void => {
      this.outboxInFlight.delete(outboxId);
      if (outboxKey !== "") advancePendingPrompt(outboxKey, outboxId, "send-refused-network");
      this.pendingPrompts = this.pendingPromptsForSession();
      this.flushPendingPrompts();
    };
    if ((outgoing.writtenOnPage && !this.isConnected) || this.outboxKey() !== outboxKey) {
      keepForItsSession();
      return;
    }

    let accepted: boolean | undefined;
    let failure: unknown;
    try {
      const replay: SendReplay = { clientMessageId: outboxId, scope, sentAt };
      accepted = await this.onSend?.(text, behavior, attachments, attachments === undefined ? undefined : delivery, replay);
    } catch (error) {
      accepted = false;
      failure = error;
    } finally {
      this.outboxInFlight.delete(outboxId);
    }
    if (failure instanceof SendScopeChangedError) {
      keepForItsSession();
      return;
    }
    if (accepted !== false) {
      if (outboxKey !== "") {
        reserveAcceptedPrompt(outboxKey, outboxId);
        this.pendingPrompts = this.pendingPromptsForSession();
      }
      return;
    }
    const left = unansweredBytesLeft(failure);
    if (left !== undefined) {
      if (outboxKey !== "") {
        advancePendingPrompt(outboxKey, outboxId, left ? "send-timeout" : "send-refused-network");
        this.pendingPrompts = this.pendingPromptsForSession();
      }
      return;
    }
    if (outboxKey !== "") {
      forgetPendingPrompt(outboxKey, outboxId);
      this.pendingPrompts = this.pendingPromptsForSession();
    }
    if (this.outboxKey() !== outboxKey) return;
    const current = this.editor?.state.doc.toString() ?? this.draft;
    if (current.trim() !== "") return;
    // The send is async: a session switch while it runs hands the failure
    // restore to the wrong composer, writing session A's text and images
    // into session B's draft. The outbox bookkeeping above stays keyed to
    // the sending session; only the visible restore is scope-guarded.
    if (machineSessionKey(this.machineId, this.sessionId ?? "") !== scopeKey) return;
    this.attachments = restorable.attachments;
    this.replaceText(restorable.text);
  }

  private resetComposer() {
    this.draft = "";
    this.currentInputMode = { kind: "normal" };
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key !== undefined) clearDraft(key);
    this.completions = [];
    this.attachments = [];
    this.attachmentError = undefined;
    // `draft` is not reactive, so the cleared text will not flow to CodeMirror
    // via `updated()`; push it to the editor document explicitly.
    this.syncEditorDoc();
  }

  static override styles = promptEditorStyles;
}

// The only `status` fields the template reads directly are the model identity
// and thinking level (shown in renderCompactStatus). Everything else the editor
// cares about (canSteer/canStop/isCompacting/sending) is passed as a separate
// property that Lit already diffs by value. Comparing just these fields lets us
// ignore the per-token status churn that does not change anything on screen.
/**
 * For a send nobody answered, whether its bytes left - the fact the bubble words it by; undefined
 * for a failure that is an answer. The controller wraps the transport error in `NetworkSendError`
 * and classifies the original, so this unwraps it too: classifying the wrapper made the record
 * say "Not sent" while the bubble said "Receiving…". The first send and a replay both use it; a
 * replay used to leave its record's state as it was whatever the retry found.
 */
function unansweredBytesLeft(failure: unknown): boolean | undefined {
  if (!handleOutcome(classifySubmission(failure, (value) => !isNetworkFailure(value) && !isRequestTimeout(value))).keepInOutbox) return undefined;
  const cause: unknown = failure instanceof NetworkSendError && failure.cause !== undefined ? failure.cause : failure;
  return transportFactsFor(cause, { isTimeout: isRequestTimeout(cause), linkOffline: linkReportedOffline(cause) }).bytesHandedToTransport;
}

function sessionStatusRenderEqual(a: SessionStatus | undefined, b: SessionStatus | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  return a.model?.id === b.model?.id
    && a.model?.provider === b.model?.provider
    && a.thinkingLevel === b.thinkingLevel;
}

function draftStorageKey(machineId: unknown, sessionId: unknown): string | undefined {
  if (typeof machineId !== "string" || machineId === "") return undefined;
  if (typeof sessionId !== "string" || sessionId === "") return undefined;
  return machineSessionKey(machineId, sessionId);
}

function emptySlashCommands(): SlashCommand[] {
  return [];
}

function emptyFileSuggestions(): FileSuggestion[] {
  return [];
}

function emptySessionModels(): SessionModel[] {
  return [];
}

function pendingToPromptAttachment(attachment: PendingAttachment): PromptAttachment {
  if (attachment.kind === "image") {
    return { kind: "image", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
  }
  return { kind: "file", mimeType: attachment.mimeType, data: attachment.data, name: attachment.name };
}

function fileExtensionLabel(name: string): string {
  const trimmed = name.trim();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex >= 0 && dotIndex < trimmed.length - 1) return trimmed.slice(dotIndex + 1, dotIndex + 5).toUpperCase();
  return "FILE";
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => { reject(reader.error ?? new Error("Failed to read file")); };
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") { reject(new Error("Unexpected file reader result")); return; }
      const commaIndex = result.indexOf(",");
      resolve(commaIndex === -1 ? result : result.slice(commaIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

const proseInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "true",
  autocorrect: "on",
  autocapitalize: "sentences",
  writingsuggestions: "true",
  dir: "auto",
};

const codeLikeInputAssistanceAttributes: Record<string, string> = {
  spellcheck: "false",
  autocorrect: "off",
  autocapitalize: "off",
  writingsuggestions: "false",
  dir: "auto",
};

function inputAssistanceContentAttributes(draftBeforeCursor: string): Record<string, string> {
  // CodeMirror is optimized for code and disables these by default, but the chat prompt is usually prose.
  return inputModeForDraft(draftBeforeCursor).kind === "normal" ? proseInputAssistanceAttributes : codeLikeInputAssistanceAttributes;
}


/**
 * The empty composer says what the field is for, and shows the three trigger
 * characters as a separate hint. Appending them to the sentence read as part
 * of it - "Message pi… / @ #" - so the symbols looked like stray punctuation
 * rather than the affordances they are.
 */
export function composerPlaceholder(): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "composer-placeholder";
  const label = document.createElement("span");
  label.className = "composer-placeholder-label";
  label.textContent = "Message pi…";
  const hints = document.createElement("span");
  hints.className = "composer-placeholder-hints";
  hints.textContent = "/ @ #";
  wrap.append(label, hints);
  return wrap;
}

type RetryBlock = "offline" | "busy" | "gone";

const RETRY_BLOCKED_NOTICE: Record<RetryBlock, string> = {
  offline: "You are offline - this message sends itself when the connection is back.",
  busy: "Another message is being resent - retry this one when it finishes.",
  gone: "This message is no longer held for a retry - it may already have been delivered.",
};

export function retryBlocked(online: boolean, replaying: boolean, held: boolean): RetryBlock | undefined {
  if (!online) return "offline";
  if (replaying) return "busy";
  return held ? undefined : "gone";
}

/** One send as it was composed, with the scope and identity its outbox record holds. */
interface OutgoingSend {
  outboxKey: string;
  outboxId: string;
  /** When the reader pressed send; the time the message keeps (B5). */
  sentAt: string;
  scope: SendScope;
  /**
   * Whether the composer was on the page when the message was written. One taken off the page
   * since - a machine switch or a cleared selection unmounts it - no longer speaks for any
   * session, and its props never change to say so.
   */
  writtenOnPage: boolean;
  text: string;
  behavior: "steer" | "followUp" | undefined;
  attachments: PromptAttachment[] | undefined;
  delivery: PromptAttachmentDelivery;
}

/**
 * How a replayed record's attachments travel: the way they were composed. The live composer
 * says nothing about a record - it was emptied when the message was sent, or holds the next
 * message's files - so a record written before delivery was recorded answers from its own
 * attachments.
 */
export function recordedDelivery(prompt: Pick<PendingPrompt, "attachments" | "delivery">): PromptAttachmentDelivery | undefined {
  if (prompt.attachments === undefined || prompt.attachments.length === 0) return undefined;
  return prompt.delivery ?? effectivePromptAttachmentDelivery("inline", prompt.attachments);
}
