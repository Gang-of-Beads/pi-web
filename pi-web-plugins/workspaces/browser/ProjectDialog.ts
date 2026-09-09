import { LitElement, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { FileSuggestion } from "@gang-of-beads/pi-web/plugin-api";
import { css } from "lit";
import { describeError } from "./errors";
import { adoptWorkspacesHostStyles } from "./hostUi";

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

@customElement("project-dialog")
export class ProjectDialog extends LitElement {
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptWorkspacesHostStyles(root);
    return root;
  }

  @property({ attribute: false }) onSubmit?: (path: string, create: boolean, trust: ProjectTrustChoice | undefined) => unknown;
  @property({ attribute: false }) onCancel?: () => void;
  /** Host-provided directory suggestions for the typed path; absent means no suggestions. */
  @property({ attribute: false }) projectDirectories?: (query: string, signal: AbortSignal) => Promise<FileSuggestion[]>;
  /** Host-provided server-resolved trust for the typed path; absent means no trust row. */
  @property({ attribute: false }) projectTrust?: (path: string) => Promise<{ path: string; decision: boolean | null; trusted: boolean }>;
  @state() private path = "";
  @state() private createMissing = true;
  /** Why the last submit did not go through, shown where the submit happened. */
  @state() private submitError: string | undefined = undefined;
  @state() private submitting = false;
  @state() private suggestions: FileSuggestion[] = [];
  /** The path the rendered suggestions were searched for. */
  @state() private suggestionsQuery: string | undefined = undefined;
  /** The search for the current path failed; never read as an empty answer. */
  @state() private suggestionsFailed = false;
  @state() private selected = 0;
  @state() private loading = false;
  @state() private trust: ProjectTrustState | undefined;
  @state() private trustTouched = false;
  @query("input") private pathInput?: HTMLInputElement;

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
    void this.loadSuggestions();
  }

  override disconnectedCallback(): void {
    this.cancelPendingSuggestions();
    this.cancelPendingTrust();
    this.abortSuggestions();
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
    const requestId = ++this.suggestionRequestId;
    const query = this.path;
    const abort = new AbortController();
    this.suggestionsAbort = abort;
    this.loading = true;
    try {
      if (this.projectDirectories === undefined) throw new Error("Folder suggestions are not available here");
      const suggestions = await this.projectDirectories(query, abort.signal);
      if (requestId !== this.suggestionRequestId) return;
      this.suggestions = suggestions;
      this.suggestionsQuery = query;
      this.suggestionsFailed = false;
      this.selected = Math.min(this.selected, Math.max(0, suggestions.length - 1));
    } catch {
      if (requestId !== this.suggestionRequestId) return;
      this.suggestions = [];
      this.suggestionsQuery = query;
      this.suggestionsFailed = true;
    } finally {
      if (requestId === this.suggestionRequestId) this.loading = false;
    }
  }

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

  private submit() {
    if (this.path.trim() === "" || this.submitting) return;
    this.submitError = undefined;
    this.submitting = true;
    void (async () => {
      try {
        // `unknown` because a caller may report nothing at all; a string is
        // read as the reason the submit did not go through.
        const failure: unknown = await this.onSubmit?.(this.path, this.createMissing, this.trust === undefined ? undefined : { trusted: this.trust.trusted, changed: this.trustTouched });
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

  private onCreateMissingChange(event: InputEvent) {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.createMissing = event.target.checked;
  }

  /**
   * Server-resolved existing trust for the entered path (never the raw path
   * trusted verbatim). Dropped when a newer path input or an explicit user
   * toggle supersedes it, so a stale read can not clobber the user's choice.
   */
  private async loadTrust() {
    const requestId = ++this.trustRequestId;
    const trimmed = this.path.trim();
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
    if (event.target !== this.pathInput) return;
    if (event.key === "Enter") {
      event.preventDefault();
      this.submit();
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
    this.pathInput?.focus();
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
          <strong>Add project</strong>
          <button @click=${() => { this.onCancel?.(); }} aria-label="Close">×</button>
        </header>
        <div class="body">
          <label>
            Project folder
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
          <small class="hint">Type any part of a folder name to search below the path you entered; end with / to browse that folder.</small>
          <div class="suggestions">
            ${this.loading ? html`<div class="hint">Loading folders…</div>` : null}
            ${this.displayedSuggestions.map((suggestion, index) => html`
              <button class=${index === this.selected ? "selected" : ""} @click=${() => { this.pick(suggestion); }}>
                ${suggestion.path}
              </button>
            `)}
            ${!this.loading && this.suggestionsFailed && this.suggestionsQuery === this.path ? html`<div class="hint">Search failed - try again</div>` : null}
            ${!this.loading && !this.suggestionsFailed && this.suggestionsQuery === this.path && this.displayedSuggestions.length === 0 ? html`<div class="hint">No matching folders found. Enter a full path to create it.</div>` : null}
          </div>
          <label class="check">
            <input type="checkbox" .checked=${this.createMissing} @change=${(event: InputEvent) => { this.onCreateMissingChange(event); }} />
            Create the folder if it does not exist
          </label>
          ${this.renderTrustChoice()}
        </div>
        ${this.submitError === undefined ? null : html`<p class="submit-error" role="alert">${this.submitError}</p>`}
        <footer>
          <button @click=${() => { this.onCancel?.(); }}>Cancel</button>
          <button class="primary" ?disabled=${this.path.trim() === "" || this.submitting} @click=${() => { this.submit(); }}>${this.submitting ? "Adding\u2026" : "Add project"}</button>
        </footer>
      </div>
    `;
  }

  static override styles = [css`
    .dialog { display: flex; flex-direction: column; min-height: 0; max-height: 100%; color: var(--pi-text); }
    header, footer { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
    footer { border-top: 1px solid var(--pi-border); border-bottom: 0; justify-content: end; }
    .body { flex: 1 1 auto; display: grid; gap: var(--pi-space-6); padding: var(--pi-space-6); min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
    label { display: grid; gap: var(--pi-space-3); color: var(--pi-muted); }
    input[type="text"], input:not([type]) { box-sizing: border-box; width: 100%; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); color: var(--pi-text); padding: var(--pi-space-5); font: var(--pi-control-font-size, 16px) var(--pi-control-monospace-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .check { display: flex; grid-template-columns: auto 1fr; align-items: center; color: var(--pi-text); }
    .suggestions { min-height: 90px; max-height: 320px; overflow: auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); }
    .suggestions button { display: block; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); text-align: left; font: var(--pi-text-sm) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); }
    .suggestions button.selected { background: var(--pi-selection-bg); }
    @media (hover: hover) { .suggestions button:hover { background: var(--pi-selection-bg); } }
    .hint { padding: var(--pi-space-6); color: var(--pi-muted); }
    /* The host list sheet clamps every <small> to one nowrap line; these are
       sentences, and the trust link inside one of them was being pushed past
       the dialog edge and clipped away entirely. */
    small.hint, .trust-hint { padding: 0; overflow: visible; text-overflow: clip; white-space: normal; }
    small.hint { line-height: 1.4; }
    .trust-error { color: var(--pi-danger, #c0392b); }
    .submit-error { flex: 0 0 auto; margin: 0; padding: 0 var(--pi-space-6) var(--pi-space-6); color: var(--pi-danger); line-height: 1.35; }
    .trust-hint { color: var(--pi-muted); line-height: 1.3; }
    .trust-hint a { color: var(--pi-accent); }
    /* Coarse pointers get the comfort floor and the AA floor across the form:
       the close control, the path field, and the trust checkbox are touch
       targets; the inline trust link meets AA through its row's line box plus
       an explicit minimum. Declared after every base rule it raises. */
    @media (pointer: coarse) {
      .check input { flex: 0 0 auto; box-sizing: border-box; width: var(--pi-checkbox-size); height: var(--pi-checkbox-size); margin: 0; accent-color: var(--pi-accent); }
      input[type="text"], input:not([type]) { min-height: var(--pi-control-height-touch, 44px); }
      .trust-hint a { display: inline-block; min-height: 24px; }
      /* The footer's floor keyed to viewport width left a tablet-class touch
         device with ~33px Cancel/Add while this same file raised the close
         control by pointer type. */
      footer button { min-height: var(--pi-control-height-touch, 44px); }
    }
    @media (max-width: 760px) {
      /* Suggestion rows double as the primary navigation control on a phone,
         so they get a full touch target and room for long paths. */
      /* The body scrolls now, so the list does not need to reserve a slice of
         the viewport for itself. */
      .suggestions { max-height: 38dvh; }
      .suggestions button { min-height: var(--pi-control-height-touch); padding: var(--pi-space-5) var(--pi-space-6); }
      footer button { min-height: var(--pi-control-height-touch); }
    }
    button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
    header button { display: grid; place-items: center; width: var(--pi-control-height); height: var(--pi-control-height); padding: 0; line-height: 1; border: 0; background: transparent; color: var(--pi-muted); font-size: var(--pi-text-xl); padding: 0 var(--pi-space-4); }
    @media (pointer: coarse) { header button { width: var(--pi-control-height-touch, 44px); height: var(--pi-control-height-touch, 44px); } }
    /* The primary action is accent-filled like every other dialog's: the
       green here was a border token pressed into service as a fill and never
       carried a label above 4.1:1. */
    .primary { border-color: var(--pi-accent); background: var(--pi-accent); color: var(--pi-on-accent, var(--pi-bg)); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
  `];
}
