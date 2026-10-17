import { LitElement, html, nothing } from "lit";
import { property, query, state } from "lit/decorators.js";
import type { FileSuggestion, PluginProjectFolders } from "@gang-of-beads/pi-web/plugin-api";
import { css } from "lit";
import { describeError } from "./errors";
import { renderHostCloseIcon, adoptWorkspacesHostStyles } from "./hostUi";
import { keyBelongsToInputMethod } from "./inputMethodKey";
import { ProjectFolderNavigator, type FolderView } from "./projectFolderNavigator";
import { folderBrowserStyles, renderFolderCrumbs, renderFolderList, renderFolderTools, type FolderBrowserActions } from "./projectFolderView";

/** The submitted trust answer; `changed` is false for the pre-filled value. */
export interface ProjectTrustChoice {
  trusted: boolean;
  changed: boolean;
}

const SUGGESTION_DEBOUNCE_MS = 120;

/** Server-resolved trust state for the entered path, keyed on the decided path. */
interface ProjectTrustState {
  path: string;
  decision: boolean | null;
  trusted: boolean;
  loading: boolean;
  error?: string;
}

/** Why the folder search shows no rows: this page cannot search, or the search did not answer and is being made again. */
type SuggestionsFailure = "unavailable" | "searchingAgain";

const SUGGESTIONS_FAILURE_WORDS: Readonly<Record<SuggestionsFailure, string>> = {
  unavailable: "Folder suggestions are not available here.",
  searchingAgain: "Searching again…",
};

/**
 * What Enter in the path field, or a tapped suggestion, does with the typed path: open it in the
 * folder browser, or, where this machine cannot list folders, submit it as the old form did.
 */
type PathEntryAction = "open" | "submit";

function pathEntryAction(view: FolderView): PathEntryAction {
  return view.kind === "unsupported" ? "submit" : "open";
}

class SuggestionsUnavailableError extends Error {
  constructor() {
    super("Folder suggestions are not available here");
    this.name = "SuggestionsUnavailableError";
  }
}

export class ProjectDialog extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptWorkspacesHostStyles(root);
    return root;
  }

  @property({ attribute: false }) onSubmit?: (path: string, create: boolean, trust: ProjectTrustChoice | undefined) => unknown;
  @property({ attribute: false }) onCancel?: () => void;
  /** The machine every read and the final add go to, captured when the dialog opened; absent on hosts without the folder browser. */
  @property({ attribute: false }) machine?: PluginProjectFolders["machine"];
  /** Host-provided one-level folder listing on `machine`; absent means this host cannot browse folders. */
  @property({ attribute: false }) listFolder?: PluginProjectFolders["listFolder"];
  /** Host-provided directory suggestions for the typed path; absent means no suggestions. */
  @property({ attribute: false }) projectDirectories?: (query: string, signal: AbortSignal) => Promise<FileSuggestion[]>;
  /** Host-provided server-resolved trust for the typed path; absent means no trust row. */
  @property({ attribute: false }) projectTrust?: (path: string) => Promise<{ path: string; decision: boolean | null; trusted: boolean }>;
  /** The typed path while the path is being edited by hand. */
  @state() private path = "";
  /** Whether the path bar is the text field (manual entry) rather than the clickable steps. */
  @state() private editing = false;
  /** The pending new folder's name while its editor is open. */
  @state() private newFolderName: string | undefined = undefined;
  /** Why the last submit did not go through, shown where the submit happened. */
  @state() private submitError: string | undefined = undefined;
  @state() private submitting = false;
  @state() private suggestions: FileSuggestion[] = [];
  /** The path the rendered suggestions were searched for. */
  @state() private suggestionsQuery: string | undefined = undefined;
  /**
   * How the search for the current path stands when it did not answer: never read as an empty
   * answer. A search nobody answered is searched again by itself (B48: no "try again" for the
   * reader); one this page cannot make at all says so.
   */
  @state() private suggestionsFailure: SuggestionsFailure | undefined = undefined;
  private suggestionsAttempt = 0;
  private suggestionsRetry: ReturnType<typeof setTimeout> | undefined;
  @state() private selected = 0;
  @state() private loading = false;
  @state() private trust: ProjectTrustState | undefined;
  @state() private trustTouched = false;
  @query(".path-field input") private pathInput?: HTMLInputElement;
  @query(".path-toggle") private pathToggle?: HTMLButtonElement;
  @query(".new-folder-form input") private newFolderInput?: HTMLInputElement;
  private readonly navigator = new ProjectFolderNavigator(
    this,
    () => (this.listFolder === undefined || this.machine === undefined ? undefined : { machineId: this.machine.id, listFolder: this.listFolder }),
    () => { this.afterListed(); },
  );
  private scrolledCrumbsFor: string | undefined;

  private suggestionTimer: ReturnType<typeof setTimeout> | undefined;
  private trustTimer: ReturnType<typeof setTimeout> | undefined;
  /** The one in-flight suggestions request; superseded requests are aborted. */
  private suggestionsAbort: AbortController | undefined;
  // Separate staleness counters: setPath fires both loaders, so a shared one
  // would make the trust read invalidate every in-flight suggestions request
  // (leaving "Loading folders…" up forever).
  private suggestionRequestId = 0;
  private trustRequestId = 0;

  override connectedCallback(): void {
    super.connectedCallback();
    this.navigator.open({ path: "" }, "Home folder");
    if (this.navigator.view.kind === "unsupported") this.editing = true;
    if (this.editing) void this.loadSuggestions();
  }

  override disconnectedCallback(): void {
    this.cancelPendingSuggestions();
    this.cancelPendingTrust();
    this.abortSuggestions();
    clearTimeout(this.suggestionsRetry);
    super.disconnectedCallback();
  }

  /**
   * Folder suggestions now search downward from the typed parent, so a
   * keystroke can cost a real directory scan. Debouncing keeps fast typing on
   * a phone keyboard from queueing one scan per character while still feeling
   * immediate once typing pauses.
   */
  private scheduleSuggestions(): void {
    this.cancelPendingSuggestions();
    // A keystroke supersedes whatever walk is still running for the previous
    // one; letting it finish would burn the server's scan budget on an answer
    // nobody is waiting for.
    this.abortSuggestions();
    this.suggestionTimer = setTimeout(() => {
      this.suggestionTimer = undefined;
      void this.loadSuggestions();
    }, SUGGESTION_DEBOUNCE_MS);
  }

  private cancelPendingSuggestions(): void {
    if (this.suggestionTimer === undefined) return;
    clearTimeout(this.suggestionTimer);
    this.suggestionTimer = undefined;
  }

  private abortSuggestions(): void {
    this.suggestionsAbort?.abort();
    this.suggestionsAbort = undefined;
  }

  private scheduleTrust(): void {
    this.cancelPendingTrust();
    this.trustTimer = setTimeout(() => {
      this.trustTimer = undefined;
      void this.loadTrust();
    }, SUGGESTION_DEBOUNCE_MS);
  }

  private cancelPendingTrust(): void {
    if (this.trustTimer === undefined) return;
    clearTimeout(this.trustTimer);
    this.trustTimer = undefined;
  }

  private async loadSuggestions() {
    this.abortSuggestions();
    clearTimeout(this.suggestionsRetry);
    const requestId = ++this.suggestionRequestId;
    const query = this.path;
    const abort = new AbortController();
    this.suggestionsAbort = abort;
    this.loading = true;
    try {
      if (this.projectDirectories === undefined) throw new SuggestionsUnavailableError();
      const suggestions = await this.projectDirectories(query, abort.signal);
      if (requestId !== this.suggestionRequestId) return;
      this.suggestions = suggestions;
      this.suggestionsQuery = query;
      this.suggestionsFailure = undefined;
      this.suggestionsAttempt = 0;
      this.selected = Math.min(this.selected, Math.max(0, suggestions.length - 1));
    } catch (error) {
      if (requestId !== this.suggestionRequestId) return;
      this.suggestions = [];
      this.suggestionsQuery = query;
      this.suggestionsFailure = error instanceof SuggestionsUnavailableError ? "unavailable" : "searchingAgain";
      this.afterSuggestionsFailure[this.suggestionsFailure]();
    } finally {
      if (requestId === this.suggestionRequestId) this.loading = false;
    }
  }

  private readonly afterSuggestionsFailure: Readonly<Record<SuggestionsFailure, () => void>> = {
    unavailable: () => undefined,
    searchingAgain: () => {
      const delay = Math.min(1_000 * 2 ** this.suggestionsAttempt, 15_000);
      this.suggestionsAttempt += 1;
      this.suggestionsRetry = setTimeout(() => { void this.loadSuggestions(); }, delay);
    },
  };

  /** The rows on screen: only those searched for the path now in the input. */
  private get displayedSuggestions(): FileSuggestion[] {
    return this.suggestionsQuery === this.path ? this.suggestions : [];
  }

  private setPath(value: string) {
    this.path = value;
    this.selected = 0;
    this.scheduleSuggestions();
    this.trustTouched = false;
    this.scheduleTrust();
  }

  /** The folder Add project adds: the typed path while editing, else the listed current folder. */
  private get target(): string {
    return this.editing ? this.path.trim() : this.navigator.currentFolder?.path ?? "";
  }

  private readonly browserActions: FolderBrowserActions = {
    open: (path, label) => { this.openFolder(path, label); },
    startNewFolder: () => { this.startNewFolder(); },
  };

  private openFolder(path: string, label: string): void {
    this.newFolderName = undefined;
    this.navigator.open({ path }, label);
    this.trustTouched = false;
    void this.loadTrust();
  }

  private afterListed(): void {
    this.newFolderName = undefined;
    if (this.editing) return;
    this.trustTouched = false;
    this.cancelPendingTrust();
    void this.loadTrust();
    if (this.shadowRoot?.activeElement === null) void this.updateComplete.then(() => { this.renderRoot.querySelector<HTMLElement>(".crumb.current")?.focus(); });
  }

  private startEditing(): void {
    this.editing = true;
    this.scrolledCrumbsFor = undefined;
    this.newFolderName = undefined;
    this.path = this.navigator.currentFolder?.path ?? this.path;
    this.selected = 0;
    void this.loadSuggestions();
    void this.loadTrust();
    void this.updateComplete.then(() => {
      this.pathInput?.focus();
      this.pathInput?.select();
    });
  }

  private stopEditing(): void {
    this.editing = false;
    this.cancelPendingSuggestions();
    this.abortSuggestions();
    clearTimeout(this.suggestionsRetry);
    this.cancelPendingTrust();
    this.trustTouched = false;
    void this.loadTrust();
    void this.updateComplete.then(() => { this.pathToggle?.focus(); });
  }

  private readonly pathEntryExecutors: Readonly<Record<PathEntryAction, (path: string) => void>> = {
    open: (path) => {
      if (path.trim() === "") return;
      this.stopEditing();
      this.openFolder(path, path);
    },
    submit: () => { this.submit(); },
  };

  private startNewFolder(): void {
    if (this.navigator.currentFolder === undefined) return;
    this.newFolderName = "";
    this.navigator.forgetNameRefusal();
    void this.updateComplete.then(() => { this.newFolderInput?.focus(); });
  }

  private createNewFolder(): void {
    const parent = this.navigator.currentFolder;
    const name = this.newFolderName;
    if (parent === undefined || name === undefined) return;
    this.navigator.open({ path: parent.path, child: name }, name);
  }

  private pick(suggestion: FileSuggestion) {
    this.path = suggestion.path;
    this.selected = 0;
    // Picking is an explicit navigation step, so its listing should not wait
    // out the typing debounce.
    this.cancelPendingSuggestions();
    this.cancelPendingTrust();
    void this.loadSuggestions();
    void this.loadTrust();
  }

  /**
   * Add the target folder. A folder that does not exist yet (a new folder, or a typed path) is
   * created by this add and by nothing before it, so cancelling leaves the disk untouched.
   */
  private submit() {
    const target = this.target;
    if (target === "" || this.submitting) return;
    this.submitError = undefined;
    this.submitting = true;
    void (async () => {
      try {
        // `unknown` because a caller may report nothing at all; a string is
        // read as the reason the submit did not go through.
        const failure: unknown = await this.onSubmit?.(target, true, this.trust === undefined ? undefined : { trusted: this.trust.trusted, changed: this.trustTouched });
        // A dialog that stays open owes the reader a reason; the global banner
        // renders behind it, so reporting there alone read as "nothing
        // happened".
        this.submitError = typeof failure === "string" && failure !== "" ? failure : undefined;
      } finally {
        this.submitting = false;
      }
    })();
  }

  private onPathInput(event: InputEvent) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.setPath(event.target.value);
  }

  /**
   * Server-resolved existing trust for the entered path (never the raw path
   * trusted verbatim). Dropped when a newer path input or an explicit user
   * toggle supersedes it, so a stale read can not clobber the user's choice.
   */
  private async loadTrust() {
    const requestId = ++this.trustRequestId;
    const trimmed = this.target;
    if (trimmed === "") {
      if (requestId === this.trustRequestId) this.trust = undefined;
      return;
    }
    if (requestId === this.trustRequestId) {
      // Keep the previous value visible (cosmetic continuity) while the read
      // for the new path is in flight; the result replaces it either way.
      this.trust = {
        ...(this.trust ?? { path: trimmed, decision: null, trusted: false }),
        path: trimmed,
        loading: true,
      };
    }
    try {
      if (this.projectTrust === undefined) throw new Error("Project trust is not available here");
      const result = await this.projectTrust(trimmed);
      if (requestId !== this.trustRequestId || this.trustTouched) return;
      this.trust = { path: result.path, decision: result.decision, trusted: result.trusted, loading: false };
    } catch (error) {
      if (requestId !== this.trustRequestId || this.trustTouched) return;
      this.trust = { path: trimmed, decision: null, trusted: false, loading: false, error: describeError(error) };
    }
  }

  private onTrustChange(checked: boolean) {
    this.trustTouched = true;
    if (this.trust !== undefined) this.trust = { ...this.trust, trusted: checked, loading: false };
  }

  private renderTrustChoice() {
    const unavailable = this.trust === undefined || this.trust.loading || this.trust.error !== undefined;
    return html`
      <label class="check">
        <input type="checkbox" .checked=${this.trust?.trusted ?? false} ?disabled=${unavailable} @change=${(event: InputEvent) => { if (event.target instanceof HTMLInputElement) this.onTrustChange(event.target.checked); }} />
        <span>Trust this project</span>
      </label>
      <small class="trust-hint">
        Trusting lets pi load this project's .pi settings, extensions, skills, and packages.
        <a href="https://pi.dev/docs/latest/security" target="_blank" rel="noreferrer">Learn about project trust</a>
      </small>
      ${this.trust?.error === undefined ? null : html`<small class="trust-error">Trust state unavailable: ${this.trust.error}</small>`}
    `;
  }

  // Escape and backdrop presses are owned by the modal surface (routed to
  // `onCancel`). The remaining keys stay scoped to the path input — their home
  // before the migration — so Enter/Tab on the footer buttons and checkbox keep
  // their native behavior.
  private onKeyDown(event: KeyboardEvent) {
    if (keyBelongsToInputMethod(event)) return;
    if (event.target === this.newFolderInput && event.key === "Enter") {
      event.preventDefault();
      this.createNewFolder();
      return;
    }
    if (event.target !== this.pathInput) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.pathEntryExecutors[pathEntryAction(this.navigator.view)](this.path);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selected = Math.min(this.selected + 1, Math.max(0, this.displayedSuggestions.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selected = Math.max(0, this.selected - 1);
    } else if (event.key === "Tab") {
      const suggestion = this.displayedSuggestions[this.selected];
      if (suggestion === undefined) return;
      event.preventDefault();
      this.pick(suggestion);
    }
  }

  protected override firstUpdated(): void {
    if (this.editing) this.pathInput?.focus();
    else this.pathToggle?.focus();
  }

  /** Long paths keep their current folder in view: the steps scroll to their end once per listed folder. */
  protected override updated(): void {
    const listed = this.navigator.currentFolder?.path;
    if (this.editing || listed === undefined || listed === this.scrolledCrumbsFor) return;
    const crumbs = this.renderRoot.querySelector(".crumbs");
    if (crumbs === null) return;
    crumbs.scrollLeft = crumbs.scrollWidth;
    this.scrolledCrumbsFor = listed;
  }

  private renderPathBar() {
    if (!this.editing) {
      return html`
        <div class="path-shell">
          ${renderFolderCrumbs(this.navigator.view, this.browserActions)}
          <button class="path-toggle" aria-label="Enter a folder path" @click=${() => { this.startEditing(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/></svg>
          </button>
        </div>
      `;
    }
    return html`
      <div class="path-shell">
        <label class="path-field">
          <span class="visually-hidden">Project folder</span>
          <input
            .value=${this.path}
            @input=${(event: InputEvent) => { this.onPathInput(event); }}
            placeholder="~/code/project, or just type playria"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="go"
          />
        </label>
        ${this.navigator.view.kind === "unsupported" ? nothing : html`
          <button class="path-toggle" aria-label="Browse folders" @click=${() => { this.stopEditing(); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9H3Z"/></svg>
          </button>
        `}
      </div>
    `;
  }

  private renderSuggestions() {
    return html`
      <small class="hint">Type a path, or any part of a folder name to search below the path you entered.</small>
      <div class="folders suggestions">
        ${this.loading ? html`<div class="hint">Loading folders…</div>` : null}
        ${this.displayedSuggestions.map((suggestion, index) => html`
          <button class=${index === this.selected ? "selected" : ""} @click=${() => { this.onSuggestionChosen(suggestion); }}>
            ${suggestion.path}
          </button>
        `)}
        ${!this.loading && this.suggestionsFailure !== undefined && this.suggestionsQuery === this.path ? html`<div class="hint">${SUGGESTIONS_FAILURE_WORDS[this.suggestionsFailure]}</div>` : null}
        ${!this.loading && this.suggestionsFailure === undefined && this.suggestionsQuery === this.path && this.displayedSuggestions.length === 0 ? html`<div class="hint">No matching folders found. Add project creates the folder you entered.</div>` : null}
      </div>
    `;
  }

  private onSuggestionChosen(suggestion: FileSuggestion): void {
    if (pathEntryAction(this.navigator.view) === "open") this.pathEntryExecutors.open(suggestion.path);
    else this.pick(suggestion);
  }

  private renderNewFolderForm() {
    if (this.newFolderName === undefined) return nothing;
    return html`
      <div class="new-folder-form">
        <label class="path-field">
          <span class="visually-hidden">New folder name</span>
          <input
            .value=${this.newFolderName}
            @input=${(event: InputEvent) => { if (event.target instanceof HTMLInputElement) this.newFolderName = event.target.value; }}
            placeholder="New folder name"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="go"
          />
        </label>
        <button ?disabled=${this.newFolderName.trim() === ""} @click=${() => { this.createNewFolder(); }}>Use</button>
        <button @click=${() => { this.newFolderName = undefined; }}>Cancel</button>
        ${this.navigator.nameRefusal === undefined ? nothing : html`<p class="field-error" role="alert">${this.navigator.nameRefusal}</p>`}
      </div>
    `;
  }

  private renderBrowser() {
    return html`
      ${renderFolderTools(this.navigator.view, this.browserActions)}
      ${this.renderNewFolderForm()}
      <div class="folders">${renderFolderList(this.navigator.view, this.machine?.name ?? "The machine", this.browserActions)}</div>
    `;
  }

  override render() {
    return html`
      <div
        class="dialog"
        role="dialog"
        aria-label="Add project"
        @keydown=${(event: KeyboardEvent) => { this.onKeyDown(event); }}
      >
        <header>
          <div class="title">
            <strong>Add project</strong>
            ${this.machine?.name === undefined ? nothing : html`<small class="machine">On ${this.machine.name}</small>`}
          </div>
          <button @click=${() => { this.onCancel?.(); }} aria-label="Close">${renderHostCloseIcon()}</button>
        </header>
        ${this.renderPathBar()}
        ${this.editing ? this.renderSuggestions() : this.renderBrowser()}
        <footer>
          <div class="trust">${this.renderTrustChoice()}</div>
          ${this.submitError === undefined ? null : html`<p class="submit-error" role="alert">${this.submitError}</p>`}
          <div class="actions">
            <button @click=${() => { this.onCancel?.(); }}>Cancel</button>
            <button class="primary" ?disabled=${this.target === "" || this.submitting} @click=${() => { this.submit(); }}>${this.submitting ? "Adding\u2026" : "Add project"}</button>
          </div>
        </footer>
      </div>
    `;
  }

  static override styles = [folderBrowserStyles, css`
    .dialog { display: flex; flex-direction: column; min-height: 0; max-height: 100%; color: var(--pi-text); }
    header { flex: 0 0 auto; display: flex; align-items: start; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6) var(--pi-space-6) var(--pi-space-5); }
    .title { display: grid; gap: var(--pi-space-2); min-width: 0; }
    .machine { color: var(--pi-muted); font-size: var(--pi-text-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    footer { flex: 0 0 auto; display: grid; gap: var(--pi-space-5); padding: var(--pi-space-6); border-top: 1px solid var(--pi-border); }
    .trust { display: grid; gap: var(--pi-space-3); }
    .actions { display: grid; grid-template-columns: 1fr 1.65fr; gap: var(--pi-space-5); }
    .visually-hidden { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
    .path-field { flex: 1 1 auto; min-width: 0; display: flex; }
    .path-shell .path-field input { border: 0; background: transparent; }
    input[type="text"], input:not([type]) { box-sizing: border-box; min-height: var(--pi-control-height); width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .check input { flex: 0 0 auto; box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); }
    .actions button, .new-folder-form button { min-height: var(--pi-control-height); }
    .check { display: flex; align-items: center; gap: var(--pi-space-3); color: var(--pi-text); }
    .suggestions button { box-sizing: border-box; display: block; width: 100%; min-height: var(--pi-control-height); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); text-align: left; font: var(--pi-text-sm) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; }
    .suggestions button.selected { background: var(--pi-selection-bg); }
    @media (hover: hover) { .suggestions button:hover { background: var(--pi-selection-bg); } }
    .hint { padding: var(--pi-space-6); color: var(--pi-muted); }
    /* The host list sheet clamps every <small> to one nowrap line; these are
       sentences, and the trust link inside one of them was being pushed past
       the dialog edge and clipped away entirely. */
    small.hint, .trust-hint { padding: 0; overflow: visible; text-overflow: clip; white-space: normal; }
    small.hint { flex: 0 0 auto; padding: var(--pi-space-3) var(--pi-space-6) 0; line-height: 1.4; }
    .trust-error { color: var(--pi-danger, #c0392b); }
    .submit-error { margin: 0; color: var(--pi-danger); line-height: 1.35; }
    .trust-hint { color: var(--pi-muted); line-height: 1.3; }
    .trust-hint a { color: var(--pi-accent); }
    /* Coarse pointers get the comfort floor and the AA floor across the form:
       the close control, the path field, and the trust checkbox are touch
       targets; the inline trust link meets AA through its row's line box plus
       an explicit minimum. Declared after every base rule it raises. */
    @media (pointer: coarse) {
      /* A touch floor belongs to the pointer, not the viewport: a tablet at
         desk width reaches this list with a finger too. */
      .suggestions button, .actions button, .new-folder-form button { min-height: var(--pi-control-height-touch, 44px); }
      input[type="text"], input:not([type]) { min-height: var(--pi-control-height-touch, 44px); }
      .check { min-height: var(--pi-control-height-touch, 44px); }
      .trust-hint a { display: inline-block; min-height: 24px; }
    }
    @media (max-width: 760px) {
      .suggestions button { padding: var(--pi-space-5) var(--pi-space-6); }
    }
    .dialog button { box-sizing: border-box; font: inherit; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    header button { display: grid; place-items: center; box-sizing: border-box; width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); margin: calc(-1 * var(--pi-space-3)) calc(-1 * var(--pi-space-4)) 0 0; line-height: 1; border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); padding: 0; }
    @media (pointer: coarse) { header button { width: var(--pi-control-height-touch, 44px); height: var(--pi-control-height-touch, 44px); } }
    /* The primary action is accent-filled like every other dialog's: the
       green here was a border token pressed into service as a fill and never
       carried a label above 4.1:1. */
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
  `];
}

if (customElements.get("project-dialog") === undefined) customElements.define("project-dialog", ProjectDialog);
