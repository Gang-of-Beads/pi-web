import type { EditorView } from "@codemirror/view";
import type { ComposerEditorHandle } from "./composerEditorSetup";

type ComposerEditorModule = typeof import("./composerEditorSetup");
import { css, LitElement, html, type PropertyValues } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { api, type FileSuggestion, type PromptAttachment, type SessionModel, type SessionStatus, type SlashCommand } from "../api";
import type { PromptAttachmentDelivery } from "../../../shared/apiTypes";
import { capturePromptAttachments, effectivePromptAttachmentDelivery, isInlinePromptAttachment, type CapturedAttachment } from "../promptAttachmentCapture";
import { inputModeForDraft, inputModesEqual, type InputMode } from "../inputModes";
import { machineSessionKey } from "../machineKeys";
import { detectPromptCompletionTrigger, fileCompletionInsertText, modelCompletionChoices, type PromptCompletionTrigger } from "../promptCompletions";
import { clearDraft, loadDraft, restoresDraftOnFirstRender, savesOutgoingDraft, saveDraft } from "../promptDraftStorage";
import { clearPendingPrompts, isNetworkFailure, loadPendingPrompts, NetworkSendError, savePendingPrompt, type PendingPrompt } from "../pendingOutbox";
import { historyIndexStep, type HistoryDirection, loadPromptHistory, rememberPromptHistory, searchPromptHistory } from "../promptHistory";
import { createMobilePromptEnterMedia, readPromptEnterPreference, shouldSendPromptOnEnterShortcut, shouldUsePromptEnterShiftShortcut } from "../promptEnterBehavior";
import { createBrowserVoiceRecorder } from "../browserVoiceRecorder";
import { isDictationConfigured } from "../speechToText";
import { resolveSpeechStreaming } from "../speechStreamProtocols";
import { isVoiceCaptureActive, voiceCaptureLabel, type VoiceCaptureState } from "../voiceCapture";
import { requestSpeechToken } from "../api/speechToken";
import { LiveDictation } from "../liveDictation";
import { captureMicrophoneSamples } from "../microphoneSamples";
import { VoiceController } from "../voiceController";
import type { PiWebSpeechToTextConfig } from "../../../shared/apiTypes";
import { type CompletionItem} from "./shared";
import { renderAttachIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";
import "./PromptHistoryPanel";

export const promptEditorStyles = css`
  /* Mobile browsers paint a rectangular highlight on tap, which looks pasted-on
     over a round or rounded control. Suppressed in favour of the app's own
     pressed and focus styling; :focus-visible still shows keyboard focus, so
     nothing is lost for keyboard users. */
  button, [role="button"], a, summary, label, input, select { font: var(--pi-text-xs) var(--pi-font-ui); -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: inherit; }
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
  dialog.attachment-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.attachment-zoom[open] { display: flex; }
  dialog.attachment-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .attachment-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; }
  .attachment-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); cursor: pointer; }
  .attachment-zoom-close:hover, .attachment-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { font: var(--pi-text-xs) var(--pi-font-ui); touch-action: manipulation; }
  :host { position: relative; z-index: 5; display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
  footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--pi-space-4); padding: var(--pi-space-6) var(--pi-chat-gutter); border-top: 1px solid var(--pi-border); max-width: var(--pi-chat-measure, 100%); margin-inline: auto; }
  /* Collapsed: one line that gives the screen back to whatever input is being
     used, and says what is still in the draft so it does not look lost. */
  footer.collapsed { padding: var(--pi-space-3) var(--pi-space-5); }
  .expand-composer { display: flex; align-items: center; gap: var(--pi-space-4); width: 100%; min-height: 44px; padding: var(--pi-space-2) var(--pi-space-5); border: 1px dashed var(--pi-border); border-radius: var(--pi-radius-pill); background: transparent; color: var(--pi-muted); font: inherit; font-size: var(--pi-text-sm); text-align: start; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .expand-composer:hover, .expand-composer:focus-visible { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .expand-composer:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .expand-composer-label { flex: 0 0 auto; }
  .expand-composer-draft { min-width: 0; overflow: hidden; color: var(--pi-dim); font-size: var(--pi-text-xs); text-overflow: ellipsis; white-space: nowrap; }
  footer.shell-mode { border-top-color: var(--pi-success); background: var(--pi-success-bg); }
  .editor-wrap { position: relative; min-width: 0; }
  .actions { display: flex; gap: var(--pi-space-4); align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
  .compact-status { display: flex; min-width: 0; align-items: center; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); flex: 1 1 0; }
  .compact-status > button { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .select-model { max-width: min(42vw, 320px); min-height: 40px; display: inline-flex; align-items: center; box-sizing: border-box; overflow: hidden; }
  /* Separate boxes so the provider gives way first and the model id survives. */
  .select-model-provider { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .select-model-id { flex: 0 0 auto; white-space: nowrap; }
  .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 36px; height: 36px; box-sizing: border-box; padding: 0; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .send-button:not(:disabled) { color: var(--pi-accent, var(--pi-text)); }
  .stop-button:not(:disabled) { color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  .editor-attach { position: absolute; right: var(--pi-space-4); bottom: var(--pi-space-4); z-index: 2; width: 32px; height: 32px; }
  .editor-attach .prompt-action-icon { width: 16px; height: 16px; }
  .editor-dictate { font-size: var(--pi-text-2xs); }
  .editor-dictate.listening { color: var(--pi-danger); border-color: var(--pi-danger); }
  textarea, .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 54px; max-height: 220px; resize: none; overflow: hidden; border-radius: var(--pi-radius-md); border: 1px solid var(--pi-border); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); }
  textarea { overflow-y: auto; padding: var(--pi-space-4); padding-right: calc(var(--pi-space-4) + 36px); }
  /* A phone with the keyboard open leaves roughly 400px of viewport, and a
     composer sized for a full screen took 119px of it - the transcript was
     left with about two lines. The composer keeps a floor so it stays usable
     and gives the rest back to what is being read. */
  @media (max-height: 620px) {
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
  .markdown-editor .cm-placeholder { position: absolute; inset-block: 0; left: 8px; right: 44px; display: flex; align-items: center; pointer-events: none; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  /* Two parts, not one sentence: the prompt sits at the reading edge and the
     trigger characters group at the trailing edge, quiet enough to read as a
     hint. */
  .composer-placeholder { display: flex; flex: 1 1 auto; align-items: center; justify-content: space-between; gap: var(--pi-space-4); min-width: 0; }
  .composer-placeholder-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .composer-placeholder-hints { flex: 0 0 auto; color: color-mix(in srgb, var(--pi-dim) 70%, transparent); font-size: var(--pi-text-xs); letter-spacing: 0.12em; }
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
  .attachments { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pi-space-4); margin: 0; padding: 0 0 var(--pi-space-1); }
  .attachment-chip { position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { display: grid; place-items: center; width: 34px; height: 26px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-xs); background: var(--pi-surface); color: var(--pi-muted); font: 700 10px/1 system-ui, sans-serif; letter-spacing: .03em; }
  .attachment-file-name { position: absolute; right: 4px; bottom: 3px; left: 4px; overflow: hidden; color: var(--pi-muted); font-size: 10px; line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; line-height: 16px; border-radius: 50%; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-sm); cursor: pointer; }
  /* A thumb is about 9mm wide. An 18px remove badge on a 56px thumbnail means
     the tap lands on the image instead, so on touch the badge grows and the
     chip grows with it rather than swallowing its own control. */
  @media (pointer: coarse) {
    .attachment-chip { width: 64px; height: 64px; }
    .attachment-remove { top: 2px; right: 2px; width: 28px; height: 28px; line-height: 26px; font-size: var(--pi-text-md); }
    .editor-attach { width: 40px; height: 40px; }
    .markdown-editor .cm-content { padding-right: 54px; }
    .markdown-editor .cm-placeholder { right: 54px; }
  }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: var(--pi-text-xs); }
  button { font: var(--pi-text-xs) var(--pi-font-ui); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  button:disabled, textarea:disabled, .markdown-editor-disabled .cm-editor { opacity: .5; cursor: not-allowed; }
      footer { gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-chat-gutter); }
    .actions { gap: var(--pi-space-3); }
    .compact-status { flex: 1 1 220px; gap: var(--pi-space-2); }
    .select-model { max-width: min(58vw, 260px); }
    button { padding: var(--pi-space-3) var(--pi-space-4); }
  }
  @media (max-width: 430px) {
    .compact-status { flex-basis: 170px; font-size: var(--pi-text-2xs); }
    .select-model { max-width: 48vw; }
    button { padding: var(--pi-space-3) var(--pi-space-4); }
    /* Narrow screens are phones: the touch targets get *bigger*, not smaller,
       and the caret keeps the line height it has on wide screens. */
    .icon-button { width: 40px; height: 40px; }
    .markdown-editor .cm-cursor { height: 1.4em !important; }
  }

  /* Hold the whole list layout still while the user is selecting rows: the
     checkbox and toolbar must not make rows jump between drags. */
  @media (max-width: 760px) {
    section { padding: var(--pi-space-4); }
    h2 { margin: 0 0 var(--pi-space-3); }
    .action-row { margin: var(--pi-space-2) 0; }
    .action-main { padding: 6px 20px 6px calc(8px + var(--depth, 0) * 14px); }
    .list-search-input { height: 30px; font-size: var(--pi-text-sm); padding: 0 var(--pi-space-4); }
    .list-search-clear { width: 30px; height: 30px; }
    .list-body.tiles { gap: var(--pi-space-3); grid-template-columns: 1fr; }
    .list-body.tiles .action-main { min-height: 48px; padding: var(--pi-space-4) 28px var(--pi-space-4) var(--pi-space-4); }
  }`;

type PendingAttachment = CapturedAttachment & { id: string };

@customElement("prompt-editor")
export class PromptEditor extends LitElement {
  @property({ type: Boolean }) disabled = false;
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
   * Step aside while another input owns the screen.
   *
   * On a phone the composer plus its action row is a third of what is left
   * above the keyboard, and while answering a question form none of it is
   * usable. Collapsed it keeps one tappable line that restores it.
   */
  @property({ type: Boolean, reflect: true }) collapsed = false;
  /**
   * Send handler. Resolving `false` means the message was not accepted, and the
   * composer puts its contents back rather than losing them.
   */
  @property({ attribute: false }) onSend?: (text: string, streamingBehavior?: "steer" | "followUp", attachments?: PromptAttachment[], delivery?: PromptAttachmentDelivery, replay?: { clientMessageId?: string }) => Promise<boolean | undefined> | boolean | undefined;
  @property({ attribute: false }) onStop?: () => void;
  @property({ attribute: false }) onSelectModel?: () => void;
  @property({ attribute: false }) onSelectThinking?: () => void;
  /** Asked to come back, when the reader taps the collapsed composer. */
  @property({ attribute: false }) onExpand?: () => void;
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
  /** Absent means dictation is not offered at all. */
  @property({ attribute: false }) speechToText?: PiWebSpeechToTextConfig;
  /** This session's own user prompts: history that reached the server, so the
   * picker works on a device that never typed here. Most recent first. */
  @property({ attribute: false }) sessionPrompts: string[] = [];
  @state() private voiceState: VoiceCaptureState = { kind: "idle" };
  @state() private zoomedAttachment?: { src: string; alt: string } | undefined;
  private voice?: VoiceController;
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
  private editorControls: ComposerEditorHandle | undefined;
  private editorLoading = false;
  /** The lazily-loaded editor module; set exactly when `editor` is set. */
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
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.pendingPrompts = this.pendingPromptsForSession();
  }

  protected override updated(changed: PropertyValues) {
    // Collapsing removes the editor's host from the DOM, which detaches the
    // CodeMirror view; expanding renders a fresh, empty host. Without tearing
    // the old view down here, `createEditor` sees a live `this.editor` and
    // declines to rebuild, so the composer came back as an empty strip with no
    // way to type and no visible draft. The rebuilt view is seeded from
    // `this.draft`, so the unsent text returns with it.
    if (changed.has("collapsed")) {
      if (this.collapsed) {
        this.editor?.destroy();
        this.editor = undefined;
        this.editorControls = undefined;
      } else {
        this.createEditor();
      }
    }
    if (changed.has("disabled")) this.updateEditorDisabledState();
    if (changed.has("sessionId") || changed.has("machineId")) this.syncEditorDoc();
    this.syncAttachmentZoomDialog();
  }

  override disconnectedCallback(): void {
    window.removeEventListener("online", this.flushPendingPrompts);
    this.editor?.destroy();
    this.editor = undefined;
    this.editorControls = undefined;
    super.disconnectedCallback();
  }

  override render() {
    if (this.collapsed) return this.renderCollapsed();
    const shellInputMode = this.currentInputMode.kind === "shell" ? this.currentInputMode : undefined;
    const shellMode = shellInputMode !== undefined;
    const queuesInput = this.canSteer || this.isCompacting;
    const busy = this.disabled || this.sending;
    return html`
      <footer class=${shellMode ? "shell-mode" : ""} @paste=${(event: ClipboardEvent) => { void this.handlePaste(event); }} @dragover=${(event: DragEvent) => { this.handleDragOver(event); }} @drop=${(event: DragEvent) => { void this.handleDrop(event); }}>
        <input class="attachment-input" type="file" multiple hidden @change=${(event: Event) => { void this.handleFileInput(event); }} />
        ${this.renderAttachments()}
        <div class="editor-wrap">
          ${shellMode ? html`<div class="mode-hint">Shell command${shellInputMode.excludeFromContext ? " · excluded from context" : ""}</div>` : null}
          ${this.renderVoiceHint()}
          ${this.isCompacting && !shellMode ? html`<div class="mode-hint">Compacting history · message will be queued</div>` : null}
          <div
            class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`}
            aria-label="Message pi"
            aria-disabled=${this.disabled ? "true" : "false"}
          ></div>
          <button class="editor-attach icon-button" ?disabled=${this.disabled} title="Attach files" aria-label="Attach files" @click=${() => { this.attachmentInput?.click(); }}>${renderAttachIcon()}</button>
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        <div class="actions">
          ${this.renderCompactStatus()}
          ${this.renderHistoryButton()}
          ${this.renderDictateButton()}
          <button class="icon-button send-button" ?disabled=${busy} title=${queuesInput ? "Steer — joins the current turn at the next safe point" : "Send message"} aria-label=${queuesInput ? "Steer current response (queued if busy)" : "Send message"} @click=${() => { this.send(this.canSteer ? "steer" : "followUp"); }}>${this.canSteer ? renderSteerIcon() : queuesInput ? renderQueueIcon() : renderSendIcon()}</button>
          <button class="icon-button stop-button" ?disabled=${this.disabled || !this.canStop} title=${this.canStop ? "Stop current work and clear queued messages" : "Nothing running"} aria-label="Stop current work" @click=${() => this.onStop?.()}>${renderStopIcon()}</button>
        </div>
      </footer>
      ${this.renderAttachmentZoom()}
      ${this.renderHistoryPanel()}
    `;
  }

  private renderCollapsed() {
    return html`
      <footer class="collapsed">
        <button
          type="button"
          class="expand-composer"
          title="Write a message"
          aria-label="Write a message to pi"
          aria-expanded="false"
          @click=${() => { this.onExpand?.(); }}
        >
          <span class="expand-composer-label">Message pi…</span>
          ${this.draftPreview === "" ? null : html`<span class="expand-composer-draft" dir="auto">${this.draftPreview}</span>`}
        </button>
      </footer>
    `;
  }

  /** The start of the unsent draft, so a collapsed composer is not a black box. */
  private get draftPreview(): string {
    const text = (this.editor?.state.doc.toString() ?? this.draft).trim().replace(/\s+/gu, " ");
    return text.length > 60 ? `${text.slice(0, 59)}…` : text;
  }

  focusInput() {
    this.editor?.focus();
  }

  /**
   * Restore a previously sent prompt: its text, plus its images as fresh
   * pending attachments.
   *
   * Replaces rather than appends, because this is a retry of one message and
   * merging it into whatever is half-typed would silently mix two prompts.
   */
  restorePrompt(prompt: { text: string; attachments: readonly PromptAttachment[] }): void {
    this.attachmentError = undefined;
    this.attachments = prompt.attachments
      .filter((attachment): attachment is Extract<PromptAttachment, { kind: "image" }> => attachment.kind === "image")
      .map((attachment, index) => {
        this.attachmentSeq += 1;
        return {
          id: `restored-${String(this.attachmentSeq)}`,
          kind: "image" as const,
          name: attachment.name ?? `image-${String(index + 1)}`,
          mimeType: attachment.mimeType,
          data: attachment.data,
          // Recomputed from the payload: the original byte size is not carried
          // in the transcript, and the previews size themselves from it.
          size: Math.floor((attachment.data.length * 3) / 4),
        };
      });
    this.replaceText(prompt.text);
    this.focusInput();
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
        <button class="select-model" title=${`Select model: ${provider}${model}`} @click=${() => this.onSelectModel?.()}>${provider === "" ? null : html`<span class="select-model-provider">${provider}</span>`}<span class="select-model-id">${model}</span></button>
        <button class="select-thinking icon-button" title=${`Thinking level: ${thinkingLevelLabel(status.thinkingLevel)}`} aria-label=${`Thinking level: ${thinkingLevelLabel(status.thinkingLevel)}`} @click=${() => this.onSelectThinking?.()}>${renderThinkingGauge(thinkingGauge(status.thinkingLevel, this.availableThinkingLevels))}</button>
      </div>
    `;
  }

  private renderAttachments() {
    if (this.attachments.length === 0 && this.attachmentError === undefined) return null;
    return html`
      <div class="attachments" aria-label="Pending attachments">
        ${this.attachments.map((attachment) => html`
          <div class=${`attachment-chip ${isInlinePromptAttachment(attachment) ? "attachment-chip-image" : "attachment-chip-file"}`} title=${attachment.name}>
            ${this.renderAttachmentPreview(attachment)}
            <button type="button" class="attachment-remove" title="Remove attachment" aria-label=${`Remove ${attachment.name}`} @click=${() => { this.removeAttachment(attachment.id); }}>×</button>
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

  private readonly onAttachmentZoomDialogClick = (event: MouseEvent): void => {
    if (event.target === this.attachmentZoomDialog) this.closeAttachmentZoom();
  };

  private syncAttachmentZoomDialog(): void {
    const dialog = this.attachmentZoomDialog;
    if (dialog === undefined) return;
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
      const close = this.renderRoot.querySelector<HTMLElement>(".attachment-zoom-close");
      (close ?? dialog).focus();
      return;
    }
    if (dialog.open) dialog.close();
  }

  private renderAttachmentZoom() {
    const zoomed = this.zoomedAttachment;
    return html`
      <dialog class="attachment-zoom" @click=${this.onAttachmentZoomDialogClick} @close=${this.closeAttachmentZoom} @cancel=${this.closeAttachmentZoom}>
        ${zoomed === undefined ? null : html`
          <button type="button" class="attachment-zoom-close" aria-label="Close image" @click=${this.closeAttachmentZoom}>×</button>
          <img class="attachment-zoom-full" src=${zoomed.src} alt=${zoomed.alt} />
        `}
      </dialog>
    `;
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
    const { attachments, error } = captured;
    if (attachments.length > 0) {
      this.attachments = [...this.attachments, ...attachments.map((attachment) => ({ id: `attachment-${String(++this.attachmentSeq)}`, ...attachment }))];
    }
    if (error !== undefined) this.attachmentError = error;
  }

  private currentAttachments(): PromptAttachment[] {
    return this.attachments.map((attachment) => pendingToPromptAttachment(attachment));
  }

  /**
   * The dictation control, rendered only when a transcription endpoint is
   * configured: without one there is nothing to send audio to, and offering a
   * microphone that cannot work would be worse than not offering it.
   */
  /**
   * A control of its own, in the row with the others. Starting dictation by
   * holding the composer was tried and taken back: holding a text field is how
   * a phone selects text, so the two gestures fought over the same press.
   */
  private renderVoiceHint() {
    const state = this.voiceState;
    if (state.kind === "idle") return null;
    const text = state.kind === "error" ? state.message
      : state.kind === "unavailable" ? state.reason
      : state.kind === "denied" ? "Microphone permission refused"
      : state.kind === "transcribing" ? "Transcribing…"
      : "Listening…";
    return html`<div class=${`mode-hint${state.kind === "error" || state.kind === "denied" || state.kind === "unavailable" ? " mode-hint-problem" : ""}`} role="status">${text}</div>`;
  }

  /**
   * Prompt history answers Ctrl/Cmd+R, which a phone cannot type. The same
   * sheet gets a visible door in the controls row whenever this session has
   * prompts behind it.
   */
  private renderHistoryButton() {
    if (this.disabled) return null;
    const key = draftStorageKey(this.machineId, this.sessionId);
    const localCount = key === undefined ? 0 : loadPromptHistory(key).length;
    if (localCount === 0 && this.sessionPrompts.length === 0) return null;
    return html`
      <button
        class="editor-history icon-button"
        type="button"
        ?disabled=${this.disabled}
        title="Reuse an earlier prompt"
        aria-label="Reuse an earlier prompt"
        @click=${() => { this.openPromptHistoryPicker(); }}
      >⟲</button>
    `;
  }

  /** The searchable history sheet, anchored above the composer so it never
   * covers the editor it fills. */
  private renderHistoryPanel() {
    if (!this.historyOpen || this.collapsed) return null;
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

  private renderDictateButton() {
    if (!isDictationConfigured(this.speechToText)) return null;
    const streaming = resolveSpeechStreaming(this.speechToText.streaming).kind !== "unavailable";
    const label = voiceCaptureLabel(this.voiceState, { streaming });
    const active = isVoiceCaptureActive(this.voiceState);
    return html`
      <button
        class=${`editor-dictate icon-button${active ? " listening" : ""}`}
        type="button"
        ?disabled=${this.disabled || this.voiceState.kind === "transcribing"}
        title=${label}
        aria-label=${label}
        aria-pressed=${String(active)}
        @click=${() => { void this.toggleDictation(); }}
      >${active ? "\u25A0" : "\u25CF"}</button>
    `;
  }

  private async toggleDictation(): Promise<void> {
    this.voice ??= new VoiceController(
      {
        recorder: createBrowserVoiceRecorder(),
        createLiveDictation: (onText, onError) => new LiveDictation({
          requestToken: requestSpeechToken,
          openSocket: (url) => new WebSocket(url),
          captureAudio: captureMicrophoneSamples,
          onText,
          onError,
          newRequestId: () => crypto.randomUUID().replaceAll("-", ""),
        }),
      },
      {
        onState: (state) => { this.voiceState = state; },
        // Inserted, never sent: the user reads what was heard before it goes
        // anywhere.
        onTranscript: (text) => { this.insertDictatedText(text); },
      },
    );
    await this.voice.toggle(this.speechToText);
  }

  /**
   * Append dictated text to whatever is already typed rather than replacing it.
   *
   * Public because it is the seam dictation lands through, and it is the
   * behaviour worth asserting: a transcript must never wipe a half-written
   * message.
   */
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

  private createEditor() {
    if (!this.editorHost || this.editor !== undefined || this.editorLoading) return;
    this.editorLoading = true;
    void import("./composerEditorSetup").then((cm) => {
      this.editorLoading = false;
      if (!this.editorHost || this.editor !== undefined || !this.isConnected) return;
      const handle = cm.createComposerEditor({
        parent: this.editorHost,
        doc: this.draft,
        disabled: this.disabled,
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
      this.cm = cm;
      this.editorControls = handle;
      this.editor = handle.view;
      // The draft may have moved while the editor bytes were on the wire.
      this.syncEditorDoc();
      this.updateEditorDisabledState();
    });
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

  private updateEditorDisabledState() {
    this.editorControls?.setDisabled(this.disabled);
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
    if (event.defaultPrevented || event.isComposing || view.composing) return false;

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
    if (this.collapsed) return false;
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key === undefined) return false;
    if (searchPromptHistory(key, "", this.sessionPrompts).length === 0) return false;
    this.historyOpen = true;
    return true;
  }

  private pendingPromptsForSession(): PendingPrompt[] {
    const key = machineSessionKey(this.machineId, this.sessionId ?? "");
    return key === "" ? [] : loadPendingPrompts(key);
  }

  private readonly flushPendingPrompts = (): void => {
    if (!navigator.onLine) return;
    const key = machineSessionKey(this.machineId, this.sessionId ?? "");
    if (key === "") return;
    const pending = loadPendingPrompts(key);
    if (pending.length === 0) return;
    let remaining = pending;
    void (async () => {
      const stillPending: PendingPrompt[] = [];
      let networkFailed = false;
      for (const prompt of remaining) {
        try {
          const accepted = await this.onSend?.(prompt.text, prompt.behavior, prompt.attachments, prompt.attachments === undefined ? undefined : this.effectiveAttachmentDelivery(), prompt.clientMessageId === undefined ? undefined : { clientMessageId: prompt.clientMessageId });
          if (accepted === false) stillPending.push(prompt);
        } catch (error) {
          networkFailed = networkFailed || isNetworkFailure(error);
          stillPending.push(prompt);
        }
      }
      if (stillPending.length === 0) clearPendingPrompts(key);
      else if (!networkFailed) clearPendingPrompts(key);
      this.pendingPrompts = stillPending.length === 0 ? [] : stillPending;
      remaining = stillPending;
    })();
  };

  private send(streamingBehavior?: "steer" | "followUp") {
    if (this.disabled || this.sending) return;
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
    void this.deliverAndRestoreOnFailure(text, behavior, attachments, delivery, restorable);
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
  ): Promise<void> {
    let accepted: boolean | undefined;
    let failure: unknown;
    try {
      accepted = await this.onSend?.(text, behavior, attachments, attachments === undefined ? undefined : delivery);
    } catch (error) {
      accepted = false;
      failure = error;
    }
    // `undefined` keeps the old contract for handlers that report nothing.
    if (accepted !== false) return;
    // A connectivity loss is retried from the outbox instead of dumped back
    // into the composer: the message survives the drop and goes out
    // automatically once the network returns.
    if (isNetworkFailure(failure)) {
      const key = machineSessionKey(this.machineId, this.sessionId ?? "");
      if (key !== "") {
        const clientMessageId = failure instanceof NetworkSendError ? failure.clientMessageId : undefined;
        savePendingPrompt(key, { text, ...(behavior === undefined ? {} : { behavior }), ...(clientMessageId === undefined ? {} : { clientMessageId }), ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }), at: new Date().toISOString() });
        this.pendingPrompts = loadPendingPrompts(key);
        return;
      }
    }
    const current = this.editor?.state.doc.toString() ?? this.draft;
    if (current.trim() !== "") return;
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

function filesFromDataTransfer(data: DataTransfer | null): File[] {
  if (data === null) return [];
  return Array.from(data.files);
}

function dataTransferHasFiles(data: DataTransfer): boolean {
  const items = Array.from(data.items);
  if (items.length > 0) return items.some((item) => item.kind === "file");
  return Array.from(data.types).includes("Files");
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
