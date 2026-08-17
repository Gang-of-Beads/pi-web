import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionInfo, Workspace } from "../api";
import { quickSwitcherModel, quickSwitcherSessionSubtitle, quickSwitcherWorkspaces, type QuickSwitcherGroup } from "../quickSwitcher";
import { sessionLabel } from "../sessionLabels";
import { keyboardEventOriginatesFromNativeActivationControl } from "./keyboardEventTarget";
import "./ModalSurface";
import { scrollWhenSelected } from "./scrollWhenSelected";

/**
 * One-surface session switcher for touch layouts.
 *
 * Creating and opening are the two things done constantly on a phone, and both
 * previously required walking the navigation accordion one section at a time.
 * This sheet puts the create action, a search field, the recent sessions, and
 * the sibling workspaces on a single scrollable surface, so neither task needs
 * a drill-down.
 */
@customElement("quick-switcher")
export class QuickSwitcher extends LitElement {
  @property({ type: Boolean }) loading = false;
  @property({ attribute: false }) sessions: readonly SessionInfo[] = [];
  @property({ attribute: false }) workspaces: readonly Workspace[] = [];
  @property({ attribute: false }) selectedSession?: SessionInfo;
  @property({ attribute: false }) selectedWorkspace?: Workspace;
  @property({ attribute: false }) activeSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) waitingSessionIds: ReadonlySet<string> = new Set();
  @property({ attribute: false }) unreadSessionIds: ReadonlySet<string> = new Set();
  @property({ type: Boolean }) canStartSession = false;
  @property({ attribute: false }) onCreateSession?: () => void;
  @property({ attribute: false }) onOpenSession?: (session: SessionInfo) => void;
  @property({ attribute: false }) onSelectWorkspace?: (workspace: Workspace) => void;
  @property({ attribute: false }) onBrowse?: () => void;
  @property({ attribute: false }) onClose?: () => void;

  @state() private query = "";

  override render() {
    const model = quickSwitcherModel({
      sessions: this.sessions,
      activeSessionIds: this.activeSessionIds,
      waitingSessionIds: this.waitingSessionIds,
      unreadSessionIds: this.unreadSessionIds,
      query: this.query,
      now: Date.now(),
    });
    const workspaces = quickSwitcherWorkspaces(this.workspaces, this.query);
    const otherWorkspaces = workspaces.filter((workspace) => workspace.id !== this.selectedWorkspace?.id);

    return html`
      <modal-surface
        .onClose=${() => this.onClose?.()}
        .initialFocus=${"input"}
        .label=${"Sessions"}
        @keydown=${(event: KeyboardEvent) => { this.handleKeyDown(event); }}
      >
        <header>
          <input
            type="search"
            inputmode="search"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
            enterkeyhint="search"
            aria-label="Search sessions and workspaces"
            placeholder="Search sessions"
            .value=${this.query}
            @input=${(event: Event) => { this.onQueryInput(event); }}
          >
          <button class="close" title="Close" aria-label="Close" @click=${() => this.onClose?.()}>×</button>
        </header>
        <div class="body">
          ${this.renderCreateRow()}
          ${model.groups.map((group) => this.renderGroup(group))}
          ${this.loading
            ? html`<p class="empty">Loading sessions…</p>`
            : model.matchCount === 0
              ? html`<p class="empty">${this.query.trim() === "" ? "No sessions yet." : `No sessions match “${this.query.trim()}”.`}</p>`
              : null}
          ${otherWorkspaces.length === 0 ? null : html`
            <h3>Workspaces</h3>
            <div class="rows">
              ${otherWorkspaces.map((workspace) => html`
                <button class="row workspace-row" @click=${() => { this.selectWorkspace(workspace); }}>
                  <span class="row-title">${workspace.label}${workspace.isMain ? " · main" : ""}</span>
                  <span class="row-subtitle">${workspace.path}</span>
                </button>
              `)}
            </div>
          `}
        </div>
        <footer>
          <button @click=${() => { this.browse(); }}>Browse machines and projects</button>
        </footer>
      </modal-surface>
    `;
  }

  private renderCreateRow() {
    const workspaceLabel = this.selectedWorkspace?.label;
    const subtitle = workspaceLabel === undefined
      ? "Select a workspace first"
      : `In ${workspaceLabel}`;
    return html`
      <button
        class="row create-row"
        ?disabled=${!this.canStartSession}
        title=${this.canStartSession ? "Start a new session" : "Select a workspace to start a session"}
        @click=${() => { this.createSession(); }}
      >
        <span class="row-title">＋ New session</span>
        <span class="row-subtitle">${subtitle}</span>
      </button>
    `;
  }

  private renderGroup(group: QuickSwitcherGroup) {
    return html`
      <h3>${group.title}</h3>
      <div class="rows">
        ${group.sessions.map((session) => this.renderSessionRow(session))}
      </div>
    `;
  }

  private renderSessionRow(session: SessionInfo) {
    const selected = this.selectedSession?.id === session.id;
    const unread = this.unreadSessionIds.has(session.id);
    const active = this.activeSessionIds.has(session.id);
    return html`
      <button
        class=${`row session-row ${selected ? "selected" : ""} ${unread ? "unread" : ""}`}
        aria-current=${selected ? "true" : nothing}
        ${scrollWhenSelected(selected, session.id)}
        @click=${() => { this.openSession(session); }}
      >
        <span class="row-title" dir="auto">${sessionLabel(session)}</span>
        <span class="row-subtitle">${quickSwitcherSessionSubtitle(session, this.workspaces)}</span>
        ${active ? html`<span class="row-flag active" title="Session is working" aria-label="Session is working"></span>` : null}
        ${!active && unread ? html`<span class="row-flag unread" title="Unread activity" aria-label="Unread activity"></span>` : null}
      </button>
    `;
  }

  // Escape is owned by the modal surface. Enter on the search field opens the
  // single remaining match, which is what makes "type two letters, hit go" work
  // on a phone keyboard without reaching for the list.
  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== "Enter" || keyboardEventOriginatesFromNativeActivationControl(event)) return;
    const model = quickSwitcherModel({
      sessions: this.sessions,
      activeSessionIds: this.activeSessionIds,
      waitingSessionIds: this.waitingSessionIds,
      unreadSessionIds: this.unreadSessionIds,
      query: this.query,
      now: Date.now(),
    });
    const first = model.groups[0]?.sessions[0];
    if (first === undefined) return;
    event.preventDefault();
    this.openSession(first);
  }

  private onQueryInput(event: Event): void {
    if (!(event.target instanceof HTMLInputElement)) return;
    this.query = event.target.value;
  }

  private createSession(): void {
    if (!this.canStartSession) return;
    this.onCreateSession?.();
    this.onClose?.();
  }

  private openSession(session: SessionInfo): void {
    this.onOpenSession?.(session);
    this.onClose?.();
  }

  private selectWorkspace(workspace: Workspace): void {
    this.onSelectWorkspace?.(workspace);
    // The sheet stays open so the workspace's own sessions can be picked
    // immediately; only choosing a session or creating one dismisses it.
    this.query = "";
  }

  private browse(): void {
    this.onBrowse?.();
    this.onClose?.();
  }

  static override styles = css`
    :host { position: fixed; inset: 0; z-index: 25; color: var(--pi-text); font: 14px system-ui, sans-serif; }
    modal-surface {
      --modal-surface-place-items: end center;
      --modal-surface-backdrop-padding: 0;
      --modal-surface-width: min(560px, 100vw);
      --modal-surface-max-height: min(88dvh, 760px);
    }
    header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; padding: 10px; border-bottom: 1px solid var(--pi-border); }
    input { box-sizing: border-box; min-width: 0; height: 40px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-bg); color: var(--pi-text); padding: 0 10px; font: 16px system-ui, sans-serif; }
    input::-webkit-search-cancel-button { display: none; }
    input:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    .close { border: 0; background: transparent; color: var(--pi-muted); font-size: 24px; line-height: 1; padding: 0 8px; cursor: pointer; }
    .body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 10px; overscroll-behavior: contain; }
    h3 { margin: 14px 4px 6px; color: var(--pi-muted); font-size: 12px; font-weight: 600; text-transform: uppercase; }
    .rows { display: grid; gap: 6px; }
    .row { position: relative; display: grid; gap: 2px; width: 100%; min-height: 52px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-text); padding: 9px 34px 9px 12px; text-align: left; cursor: pointer; }
    .row:hover:not(:disabled) { background: var(--pi-surface-hover); }
    .row:disabled { opacity: .55; cursor: not-allowed; }
    .row-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 15px; }
    .row-subtitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: 12px; }
    .create-row { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
    .create-row .row-title { font-weight: 650; }
    .session-row.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .session-row.unread .row-title { color: var(--pi-text-bright); font-weight: 650; }
    .row-flag { position: absolute; top: 50%; right: 12px; width: 8px; height: 8px; margin-top: -4px; border-radius: 50%; }
    .row-flag.active { background: var(--pi-success); }
    .row-flag.unread { background: var(--pi-accent); }
    .empty { margin: 16px 4px; color: var(--pi-muted); }
    footer { flex: 0 0 auto; padding: 10px; padding-bottom: max(10px, env(safe-area-inset-bottom)); border-top: 1px solid var(--pi-border); }
    footer button { width: 100%; min-height: 44px; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "quick-switcher": QuickSwitcher;
  }
}
