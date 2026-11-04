import { LitElement, css, html, type TemplateResult, unsafeCSS } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import { folderNameProblem, projectRenameNameWords } from "../../../shared/projectRenameProtocol";
import type { ProjectRenameView, ProjectRenameViewBlocker } from "../api/projectRenameParser";
import { describeError } from "../notice";
import { barKeyStyles } from "./appShell/panelHeaderStyles";
import "./ModalSurface";
import { renameDialogStyles } from "./SessionRenameDialog";
import { interactiveSurfaceStyles } from "./shared";
import { renderCrossIcon, uiIconStyle } from "./uiIcons.js";

/** How long typing settles before the machine is asked about the name. */
const NAME_CHECK_DELAY_MS = 150;
/** How often a dialog that something blocks asks again, so the button opens once the session or shell stops; only while what blocks can go away by itself. */
const BLOCKED_RECHECK_MS = 3_000;

/**
 * Rename a project, which renames its folder (owner, 2026-11-04): the project's name is the
 * folder's. The machine answers what is in the way - a session working, a shell open - and what is
 * wrong with the name, and the dialog keeps asking while something that goes away by itself
 * blocks, so the button opens when the work ends; what stays (a folder PI WEB keeps its own files
 * in) is said once. Rename opens only for a name the machine has checked. The rename stays in the
 * dialog until the machine answers: a failed one says what happened (everything put back, or what
 * was not) where the reader is looking.
 */
@customElement("project-rename-dialog")
export class ProjectRenameDialog extends LitElement {
  @property({ attribute: false }) machineName = "";
  /** The folder's name as the project list knows it, until the machine answers. */
  @property({ attribute: false }) currentName = "";
  /** The machine's preview for a name, or for none; the dialog names no API. */
  @property({ attribute: false }) preview?: (name: string | undefined, signal: AbortSignal) => Promise<ProjectRenameView>;
  /** Rename to `name`; throws when the machine refused or failed. */
  @property({ attribute: false }) onSubmit?: (name: string) => Promise<void>;
  @property({ attribute: false }) onCancel?: () => void;

  @state() private draft = "";
  @state() private view: ProjectRenameView | undefined;
  /** The name the view's name problem answers for. */
  @state() private viewName: string | undefined;
  @state() private readProblem: string | undefined;
  @state() private submitting = false;
  @state() private failure: string | undefined;
  @query("input") private nameInput?: HTMLInputElement;

  private reading: AbortController | undefined;
  private nameTimer: ReturnType<typeof setTimeout> | undefined;
  private recheckTimer: ReturnType<typeof setTimeout> | undefined;

  static override styles = [css`${unsafeCSS(uiIconStyle)}`, interactiveSurfaceStyles, renameDialogStyles, css`
    header .title { display: flex; flex-direction: column; gap: var(--pi-space-1); min-width: 0; }
    header small { color: var(--pi-muted); font-size: var(--pi-text-xs); }
    .parent { color: var(--pi-muted); font-size: var(--pi-text-xs); overflow-wrap: anywhere; }
    .problem { color: var(--pi-danger); font-size: var(--pi-text-sm); margin: 0; overflow-wrap: anywhere; }
    .blockers { margin: 0; padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); font-size: var(--pi-text-sm); }
    .blockers p { margin: 0; }
    .blockers ul { margin: var(--pi-space-2) 0 0; padding-left: var(--pi-space-8); }
    .blockers + .blockers { margin-top: var(--pi-space-4); }
  `, barKeyStyles];

  override connectedCallback(): void {
    super.connectedCallback();
    this.draft = this.currentName;
    void this.read(undefined);
  }

  override disconnectedCallback(): void {
    this.reading?.abort();
    clearTimeout(this.nameTimer);
    clearTimeout(this.recheckTimer);
    super.disconnectedCallback();
  }

  protected override firstUpdated(): void {
    this.nameInput?.select();
  }

  private get folderName(): string {
    return this.view?.folderName ?? this.currentName;
  }

  /** What the browser can already say about the name, without the machine: the rules that hold everywhere. */
  private get localProblem(): string | undefined {
    const problem = folderNameProblem(this.draft, this.folderName, false);
    if (problem === undefined || problem === "empty" || problem === "unchanged") return undefined;
    return projectRenameNameWords(problem, this.draft.trim());
  }

  private get nameless(): boolean {
    const problem = folderNameProblem(this.draft, this.folderName, false);
    return problem === "empty" || problem === "unchanged";
  }

  private async read(name: string | undefined): Promise<void> {
    this.reading?.abort();
    clearTimeout(this.recheckTimer);
    const reading = new AbortController();
    this.reading = reading;
    try {
      const view = await this.preview?.(name, reading.signal);
      if (reading.signal.aborted || view === undefined) return;
      this.view = view;
      this.viewName = name;
      this.readProblem = undefined;
    } catch (error) {
      if (reading.signal.aborted) return;
      this.readProblem = describeError(error);
    }
    if (this.view === undefined || this.view.blockers.some(({ clears }) => clears) || this.readProblem !== undefined) {
      this.recheckTimer = setTimeout(() => { void this.read(this.askableName()); }, BLOCKED_RECHECK_MS);
    }
  }

  private askableName(): string | undefined {
    return this.nameless || this.localProblem !== undefined ? undefined : this.draft;
  }

  private handleInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.draft = event.target.value;
    this.failure = undefined;
    clearTimeout(this.nameTimer);
    const name = this.askableName();
    if (name !== undefined) this.nameTimer = setTimeout(() => { void this.read(name); }, NAME_CHECK_DELAY_MS);
  }

  private handleSubmit(event: SubmitEvent): void {
    event.preventDefault();
    void this.submit();
  }

  private get canSubmit(): boolean {
    if (this.submitting || this.view === undefined || this.view.blockers.length > 0) return false;
    if (this.nameless || this.localProblem !== undefined) return false;
    return this.viewName === this.draft && this.view.nameProblem === undefined;
  }

  private async submit(): Promise<void> {
    if (!this.canSubmit) return;
    this.submitting = true;
    this.failure = undefined;
    try {
      await this.onSubmit?.(this.draft.trim());
    } catch (error) {
      if (!this.isConnected) return;
      this.failure = describeError(error);
      void this.read(this.askableName());
    } finally {
      if (this.isConnected) this.submitting = false;
    }
  }

  private cancel(): void {
    if (!this.submitting) this.onCancel?.();
  }

  override render(): TemplateResult {
    const view = this.view;
    const nameProblem = this.localProblem ?? (this.viewName === this.draft ? view?.nameProblem : undefined);
    return html`
      <modal-surface .onClose=${() => { this.cancel(); }} .initialFocus=${"input"} .label=${"Rename project"}>
        <form @submit=${(event: SubmitEvent) => { this.handleSubmit(event); }}>
          <header>
            <span class="title"><strong>Rename project</strong>${this.machineName === "" ? null : html`<small>On ${this.machineName}</small>`}</span>
            <button type="button" class="bar-key" ?disabled=${this.submitting} @click=${() => { this.cancel(); }} aria-label="Close">${renderCrossIcon()}</button>
          </header>
          <div class="body">
            <label>
              Folder name
              ${view === undefined ? null : html`<span class="parent" dir="ltr">${view.parentPath}</span>`}
              <input type="text" .value=${this.draft} ?disabled=${this.submitting} @input=${(event: Event) => { this.handleInput(event); }} maxlength="255" autocomplete="off" spellcheck="false" />
            </label>
            ${nameProblem === undefined ? null : html`<p class="problem" role="alert">${nameProblem}</p>`}
            <p class="hint">The project and its folder both take this name. Its sessions and trust follow the folder.</p>
            ${renderBlockers("This folder cannot be renamed here:", view?.blockers.filter(({ clears }) => !clears))}
            ${renderBlockers("Stop these first to rename:", view?.blockers.filter(({ clears }) => clears))}
            ${this.readProblem === undefined ? null : html`<p class="problem" role="status">${this.machineName === "" ? "The machine" : this.machineName} did not answer: ${this.readProblem}</p>`}
            ${this.failure === undefined ? null : html`<p class="problem" role="alert">${this.failure}</p>`}
          </div>
          <footer>
            <button type="button" ?disabled=${this.submitting} @click=${() => { this.cancel(); }}>Cancel</button>
            <button class="primary" type="submit" ?disabled=${!this.canSubmit}>${this.submitting ? "Renaming\u2026" : "Rename"}</button>
          </footer>
        </form>
      </modal-surface>
    `;
  }
}

function renderBlockers(heading: string, blockers: readonly ProjectRenameViewBlocker[] | undefined): TemplateResult | null {
  if (blockers === undefined || blockers.length === 0) return null;
  return html`<div class="blockers" role="status">
    <p>${heading}</p>
    <ul>${blockers.map(({ label }) => html`<li>${label}</li>`)}</ul>
  </div>`;
}

declare global {
  interface HTMLElementTagNameMap {
    "project-rename-dialog": ProjectRenameDialog;
  }
}
