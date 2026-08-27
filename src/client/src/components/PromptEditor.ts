import { defaultKeymap, history, historyKeymap, indentWithTab, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, deleteMarkupBackward, insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState, Compartment } from "@codemirror/state";
import { drawSelection, EditorView, keymap, placeholder } from "@codemirror/view";
import { defaultHighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { LitElement, html, type PropertyValues } from "lit";
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
import { VoiceController } from "../voiceController";
import type { PiWebSpeechToTextConfig } from "../../../shared/apiTypes";
import { promptEditorStyles, type CompletionItem } from "./shared";
import { renderAttachIcon, renderSendIcon, renderQueueIcon, renderSteerIcon, renderStopIcon, renderThinkingGauge } from "./promptEditorIcons";
import { thinkingGauge, thinkingLevelLabel } from "../../../shared/thinkingLevels";
import "./AutocompleteMenu";

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
  /** Absent means dictation is not offered at all. */
  @property({ attribute: false }) speechToText?: PiWebSpeechToTextConfig;
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
  private readonly editableCompartment = new Compartment();
  private readonly readOnlyCompartment = new Compartment();
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
          ${this.isCompacting && !shellMode ? html`<div class="mode-hint">Compacting history · message will be queued</div>` : null}
          <div
            class=${`markdown-editor${this.disabled ? " markdown-editor-disabled" : ""}`}
            aria-label="Message pi"
            aria-disabled=${this.disabled ? "true" : "false"}
          ></div>
          <button class="editor-attach icon-button" ?disabled=${busy} title="Attach files" aria-label="Attach files" @click=${() => { this.attachmentInput?.click(); }}>${renderAttachIcon()}</button>
          <autocomplete-menu .items=${this.completions} .selectedIndex=${this.selectedIndex} .onPick=${(item: CompletionItem) => { this.pick(item); }}></autocomplete-menu>
        </div>
        <div class="actions">
          ${this.renderCompactStatus()}
          ${this.renderDictateButton(busy)}
          <button class="icon-button send-button" ?disabled=${busy} title=${queuesInput ? "Steer — joins the current turn at the next safe point" : "Send message"} aria-label=${queuesInput ? "Steer current response (queued if busy)" : "Send message"} @click=${() => { this.send(this.canSteer ? "steer" : "followUp"); }}>${this.canSteer ? renderSteerIcon() : queuesInput ? renderQueueIcon() : renderSendIcon()}</button>
          <button class="icon-button stop-button" ?disabled=${this.disabled || !this.canStop} title=${this.canStop ? "Stop current work and clear queued messages" : "Nothing running"} aria-label="Stop current work" @click=${() => this.onStop?.()}>${renderStopIcon()}</button>
        </div>
      </footer>
      ${this.renderAttachmentZoom()}
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
    if (editor !== undefined) {
      const current = editor.state.doc.toString();
      editor.dispatch({
        ...(current === text ? {} : { changes: { from: 0, to: current.length, insert: text } }),
        selection: EditorSelection.cursor(text.length),
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
  private renderDictateButton(busy: boolean) {
    if (!isDictationConfigured(this.speechToText)) return null;
    const streaming = resolveSpeechStreaming(this.speechToText.streaming).kind !== "unavailable";
    const label = voiceCaptureLabel(this.voiceState, { streaming });
    const active = isVoiceCaptureActive(this.voiceState);
    return html`
      <button
        class=${`editor-dictate icon-button${active ? " listening" : ""}`}
        type="button"
        ?disabled=${busy || this.voiceState.kind === "transcribing"}
        title=${label}
        aria-label=${label}
        aria-pressed=${String(active)}
        @click=${() => { void this.toggleDictation(); }}
      >${active ? "\u25A0" : "\u25CF"}</button>
    `;
  }

  private async toggleDictation(): Promise<void> {
    this.voice ??= new VoiceController(
      { recorder: createBrowserVoiceRecorder() },
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
    if (!this.editorHost || this.editor !== undefined) return;
    this.editor = new EditorView({
      parent: this.editorHost,
      state: EditorState.create({
        doc: this.draft,
        extensions: [
          history(),
          markdown(),
          indentOnInput(),
          indentUnit.of("  "),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          EditorView.lineWrapping,
          drawSelection(),
          EditorView.contentAttributes.of((view) => inputAssistanceContentAttributes(view.state.sliceDoc(0, view.state.selection.main.head))),
          EditorView.domEventHandlers({
            keyup: (event) => this.handleEditorKeyUp(event),
            blur: () => this.resetEditorModifierState(),
          }),
          placeholder(composerPlaceholder()),
          this.editableCompartment.of(EditorView.editable.of(!this.disabled)),
          this.readOnlyCompartment.of(EditorState.readOnly.of(this.disabled)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) this.updateDraft(update.state.doc.toString());
          }),
          keymap.of([
            { any: (view, event) => this.handleEditorKeyDown(event, view) },
            { key: "ArrowDown", run: (view) => this.handleEditorArrow(view, "newer") },
            { key: "ArrowUp", run: (view) => this.handleEditorArrow(view, "older") },
            { key: "Escape", run: () => this.closeCompletions() },
            { key: "Tab", run: (view) => this.handleEditorTab(view) },
            { key: "Shift-Tab", run: (view) => indentWithTab.shift?.(view) ?? false },
            { key: "Backspace", run: (view) => deleteMarkupBackward(view) },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
        ],
      }),
    });
  }

  private syncEditorDoc() {
    const editor = this.editor;
    if (!editor) return;
    const current = editor.state.doc.toString();
    if (current === this.draft) return;
    editor.dispatch({
      changes: { from: 0, to: current.length, insert: this.draft },
      selection: EditorSelection.cursor(this.draft.length),
    });
  }

  private updateEditorDisabledState() {
    this.editor?.dispatch({
      effects: [
        this.editableCompartment.reconfigure(EditorView.editable.of(!this.disabled)),
        this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(this.disabled)),
      ],
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
      return insertNewlineContinueMarkup(view) || insertNewlineAndIndent(view);
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
    return indentWithTab.run?.(view) ?? false;
  }

  private pick(item: CompletionItem) {
    const editor = this.editor;
    if (!editor) return;
    if (item.kind === "history") {
      this.historyIndex = undefined;
      this.replaceText(item.insertText);
      this.completions = [];
      return;
    }
    const suffix = item.kind === "file" && (item.insertText.endsWith("/") || item.cursorOffset !== undefined) ? "" : " ";
    const cursor = item.replaceFrom + (item.cursorOffset ?? item.insertText.length) + suffix.length;
    const replaceTo = item.insertText.endsWith("\"") && this.draft.slice(item.replaceTo).startsWith("\"") ? item.replaceTo + 1 : item.replaceTo;
    editor.dispatch({
      changes: { from: item.replaceFrom, to: replaceTo, insert: `${item.insertText}${suffix}` },
      selection: EditorSelection.cursor(cursor),
      scrollIntoView: true,
    });
    this.completions = [];
  }

  private openPromptHistoryPicker(): boolean {
    const key = draftStorageKey(this.machineId, this.sessionId);
    if (key === undefined) return false;
    const matches = searchPromptHistory(key, this.draft).slice(0, 12);
    if (matches.length === 0) return false;
    this.selectedIndex = 0;
    this.completions = matches.map((entry) => ({
      kind: "history",
      replaceFrom: 0,
      replaceTo: this.draft.length,
      insertText: entry,
      detail: "history",
      description: entry,
    }));
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
