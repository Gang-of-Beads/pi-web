import { LitElement, css, html } from "lit";
import { customElement, property, query, state } from "lit/decorators.js";
import type { Machine, Project, SessionInfo, Workspace } from "../../api";
import { shortSessionId } from "../../sessionLabels";
import type { NavigationSection } from "../../appShell/navigationState";

@customElement("app-context-bar")
export class AppContextBar extends LitElement {
  @property({ attribute: false }) machines: Machine[] = [];
  @property({ attribute: false }) machine?: Machine;
  @property({ attribute: false }) project?: Project;
  @property({ attribute: false }) workspace?: Workspace;
  @property({ attribute: false }) session?: SessionInfo;
  @property({ attribute: false }) refreshControl: unknown;
  @property({ attribute: false }) onOpenSection?: (section: NavigationSection) => void;
  @property({ attribute: false }) onShowActions?: () => void;
  /**
   * Opens the flat session sheet. When present it replaces the session chip's
   * drill-down, because picking a session is the one context change that
   * should never cost a walk through the navigation accordion.
   */
  @property({ attribute: false }) onQuickSwitch?: () => void;
  /** Rename the session being read. Absent when renaming is not available. */
  @property({ attribute: false }) onRenameSession?: (name: string) => void;
  /** Whether the session being read has work in progress. */
  @property({ type: Boolean }) isWorking = false;
  /**
   * Lead with the session instead of the full location trail.
   *
   * While reading a conversation the session is the subject, and the machine /
   * project / workspace chips are only how the user got there. Set on the chat
   * surface so the session's name is the heading rather than the last of four
   * equally weighted chips, while the trail collapses into one breadcrumb that
   * still reaches every level. Height is unchanged: one row either way.
   */
  @property({ type: Boolean }) emphasizeSession = false;
  @query(".context-items") private contextItems?: HTMLElement | null;
  @state() private renamingSession = false;
  /** The name shown the moment the edit opened; the input is seeded from it. */
  @state() private renameSeed = "";
  /** Tracks whether the just-opened input has had its one-time select. */
  private renameInputSeeded = false;
  @state() private canScrollLeft = false;
  @state() private canScrollRight = false;
  private observedContextItems: HTMLElement | undefined;
  private contextItemsResizeObserver: ResizeObserver | undefined;

  override disconnectedCallback(): void {
    this.contextItemsResizeObserver?.disconnect();
    this.contextItemsResizeObserver = undefined;
    this.observedContextItems = undefined;
    super.disconnectedCallback();
  }

  override firstUpdated(): void {
    this.observeContextItems();
    this.updateScrollState();
  }

  override updated(): void {
    this.observeContextItems();
    this.updateScrollState();
    // Select the text exactly once, when the input first appears, so the tap
    // that starts the edit also opens the keyboard and a correction can be
    // typed straight away. Every later render -- a fresh token streaming in,
    // a status change -- must leave the user's caret and draft untouched.
    const renameInput = this.renderRoot.querySelector<HTMLInputElement>(".context-session-input");
    if (renameInput !== null && !this.renameInputSeeded) {
      this.renameInputSeeded = true;
      renameInput.select();
    } else if (renameInput === null) {
      this.renameInputSeeded = false;
    }
  }

  override render() {
    if (this.emphasizeSession && this.session !== undefined) return this.renderSessionLed();
    return this.renderLocationTrail();
  }

  /**
   * Session-led layout: one breadcrumb for where we are, then the session name
   * as the heading. The breadcrumb opens the deepest section that still has a
   * choice to make, so no level becomes unreachable.
   */
  private renderSessionLed() {
    const breadcrumb = breadcrumbLabel(this.workspace, this.project, this.machine, this.machines);
    const label = sessionContextLabel(this.session);
    return html`
      <nav class=${this.contextBarClass()} aria-label="Current session">
        <button
          type="button"
          class="context-breadcrumb"
          title=${breadcrumbTitle(this.workspace, this.project)}
          aria-label=${`Location: ${breadcrumb}. Open navigation.`}
          @click=${() => { this.onOpenSection?.(this.breadcrumbSection()); }}
        >${breadcrumb}</button>
        ${this.renamingSession
          ? html`<span class="context-session-edit">
              <input
                class="context-session-input"
                type="text"
                .value=${this.renameSeed}
                aria-label="Session name"
                enterkeyhint="done"
                spellcheck="false"
                autocomplete="off"
                @keydown=${(event: KeyboardEvent) => { this.onRenameKeydown(event); }}
                @blur=${() => { this.renamingSession = false; }}
              >
              <button
                type="button"
                class="context-session-edit-button confirm"
                aria-label="Save session name"
                title="Save"
                @pointerdown=${(event: PointerEvent) => { event.preventDefault(); }}
                @click=${() => { this.commitRename(); }}
              >✓</button>
              <button
                type="button"
                class="context-session-edit-button abandon"
                aria-label="Cancel renaming"
                title="Cancel"
                @pointerdown=${(event: PointerEvent) => { event.preventDefault(); }}
                @click=${() => { this.renamingSession = false; }}
              >✕</button>
            </span>`
          : html`<button
              type="button"
              class="context-session-title"
              title=${sessionContextTitle(this.session)}
              aria-label=${`Session: ${label}. Open session selection.`}
              @click=${() => { this.openSessions(); }}
            >${label}</button>`}
        ${this.isWorking
          ? html`<span
              class="context-working"
              role="status"
              aria-label="Session is working"
              title="Session is working"
            ><span class="context-working-dot"></span><span class="context-working-dot"></span><span class="context-working-dot"></span></span>`
          : null}
        ${this.onRenameSession === undefined || this.session === undefined || this.renamingSession
          ? null
          : html`<button
              type="button"
              class="context-session-rename"
              title="Rename session"
              aria-label=${`Rename session ${label}`}
              @click=${() => { this.renameSeed = label; this.renamingSession = true; }}
            >✎</button>`}
        ${this.hasContextActions() ? html`<div class="context-actions inline">${this.renderQuickSwitchButton()}${this.renderActionsButton()}${this.refreshControl}</div>` : null}
      </nav>
    `;
  }

  /**
   * Enter saves, Escape abandons.
   *
   * An unchanged or blank name is treated as no rename at all: the edit starts
   * seeded with the current name, so clearing it is far more likely to be a
   * slip than an intent to remove the name the user is looking at.
   */
  private onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      this.renamingSession = false;
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    this.commitRename();
  }

  /** Shared by Enter and the confirm button; never fires for blank/unchanged. */
  private commitRename(): void {
    const input = this.renderRoot.querySelector<HTMLInputElement>(".context-session-input");
    const next = (input?.value ?? "").trim();
    this.renamingSession = false;
    if (next === "" || next === this.renameSeed || next === this.session?.name) return;
    this.onRenameSession?.(next);
  }

  /** Section the breadcrumb opens: the deepest one already chosen. */
  private breadcrumbSection(): NavigationSection {
    if (this.workspace !== undefined) return "workspaces";
    if (this.project !== undefined) return "projects";
    return shouldShowMachineContext(this.machines) ? "machines" : "projects";
  }

  private renderLocationTrail() {
    const showMachineContext = shouldShowMachineContext(this.machines);
    const machineLabel = machineContextLabel(this.machine);
    const projectLabel = projectContextLabel(this.project);
    const workspaceLabel = workspaceContextLabel(this.workspace);
    const sessionLabel = sessionContextLabel(this.session);
    return html`
      <nav class=${this.contextBarClass()} aria-label="Current location">
        <span class="context-bar-label">Location</span>
        <ol class="context-items" @scroll=${this.onContextScroll}>
          ${showMachineContext ? html`
            <li class="context-item">
              <button type="button" class=${this.machine === undefined ? "context-chip empty" : "context-chip"} title=${machineContextTitle(this.machine)} aria-label=${`Machine: ${machineLabel}. Open machine selection.`} @click=${() => { this.onOpenSection?.("machines"); }}>
                <span class="context-kind">Machine</span>
                <span class="context-value">${machineLabel}</span>
              </button>
            </li>
          ` : null}
          <li class="context-item">
            <button type="button" class=${this.project === undefined ? "context-chip empty" : "context-chip"} title=${projectContextTitle(this.project)} aria-label=${`Project: ${projectLabel}. Open project selection.`} @click=${() => { this.onOpenSection?.("projects"); }}>
              <span class="context-kind">Project</span>
              <span class="context-value">${projectLabel}</span>
            </button>
          </li>
          <li class="context-item">
            <button type="button" class=${this.workspace === undefined ? "context-chip empty" : "context-chip"} title=${workspaceContextTitle(this.workspace)} aria-label=${`Workspace: ${workspaceLabel}. Open workspace selection.`} @click=${() => { this.onOpenSection?.("workspaces"); }}>
              <span class="context-kind">Workspace</span>
              <span class="context-value">${workspaceLabel}</span>
            </button>
          </li>
          <li class="context-item">
            <button type="button" class=${this.session === undefined ? "context-chip empty" : "context-chip"} title=${sessionContextTitle(this.session)} aria-label=${`Session: ${sessionLabel}. Open session selection.`} @click=${() => { this.openSessions(); }}>
              <span class="context-kind">Session</span>
              <span class="context-value">${sessionLabel}</span>
            </button>
          </li>
        </ol>
        ${this.hasContextActions() ? html`<div class="context-actions">${this.renderQuickSwitchButton()}${this.renderActionsButton()}${this.refreshControl}</div>` : null}
      </nav>
    `;
  }

  private openSessions(): void {
    if (this.onQuickSwitch !== undefined) {
      this.onQuickSwitch();
      return;
    }
    this.onOpenSection?.("sessions");
  }

  private renderQuickSwitchButton() {
    if (this.onQuickSwitch === undefined) return null;
    return html`
      <button type="button" class="context-action-button" title="Sessions" aria-label="Open sessions" @click=${(event: MouseEvent) => { event.stopPropagation(); this.onQuickSwitch?.(); }}>
        <svg class="context-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 6h16M4 12h16M4 18h10"></path>
        </svg>
      </button>
    `;
  }

  private renderActionsButton() {
    if (this.onShowActions === undefined) return null;
    return html`
      <button type="button" class="context-action-button" title="Show Actions" aria-label="Show Actions" @click=${(event: MouseEvent) => { event.stopPropagation(); this.onShowActions?.(); }}>
        <svg class="context-action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M13 2 4 14h7l-1 8 10-13h-7V2Z"></path>
        </svg>
      </button>
    `;
  }

  private contextBarClass(): string {
    const classes = ["context-bar"];
    if (this.hasContextActions()) classes.push("has-context-actions");
    if (this.refreshControl !== undefined && this.onShowActions !== undefined) classes.push("has-context-actions-double");
    if (this.canScrollLeft) classes.push("can-scroll-left");
    if (this.canScrollRight) classes.push("can-scroll-right");
    return classes.join(" ");
  }

  private hasContextActions(): boolean {
    return this.refreshControl !== undefined || this.onShowActions !== undefined || this.onQuickSwitch !== undefined;
  }

  private observeContextItems(): void {
    const contextItems = this.contextItemsElement();
    if (this.observedContextItems === contextItems) return;
    this.contextItemsResizeObserver?.disconnect();
    this.observedContextItems = contextItems;
    this.contextItemsResizeObserver = undefined;
    if (contextItems === undefined || typeof ResizeObserver === "undefined") return;
    this.contextItemsResizeObserver = new ResizeObserver(() => {
      this.updateScrollState();
    });
    this.contextItemsResizeObserver.observe(contextItems);
  }

  private updateScrollState(): void {
    const contextItems = this.contextItemsElement();
    const maxScrollLeft = contextItems === undefined ? 0 : Math.max(0, contextItems.scrollWidth - contextItems.clientWidth);
    const canScrollLeft = contextItems !== undefined && contextItems.scrollLeft > 1;
    const canScrollRight = contextItems !== undefined && maxScrollLeft - contextItems.scrollLeft > 1;
    if (this.canScrollLeft !== canScrollLeft) this.canScrollLeft = canScrollLeft;
    if (this.canScrollRight !== canScrollRight) this.canScrollRight = canScrollRight;
  }

  private contextItemsElement(): HTMLElement | undefined {
    const contextItems = this.contextItems;
    return contextItems instanceof HTMLElement ? contextItems : undefined;
  }

  private readonly onContextScroll = () => {
    this.updateScrollState();
  };

  static override styles = css`
    /* The edit replaces the title in place; nothing else may move under the
       user's thumb, so the row keeps one line and the controls beside it keep
       their slots. 40px + 16px font keep the field tappable and free of the
       iOS auto-zoom that shrinks 15px inputs when they are focused. */
    .context-session-edit { flex: 1 1 auto; display: inline-flex; align-items: center; gap: 4px; min-width: 0; }
    .context-session-input { flex: 1 1 auto; min-width: 0; box-sizing: border-box; min-height: 40px; padding: 4px 10px; border: 1px solid var(--pi-accent-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-text-bright); font-size: 16px; box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 10%, transparent); }
    .context-session-input:focus { outline: none; border-color: var(--pi-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--pi-accent) 26%, transparent); }
    .context-session-edit-button { flex: 0 0 auto; display: grid; place-items: center; box-sizing: border-box; width: 38px; min-height: 40px; padding: 0; border: 1px solid var(--pi-border); border-radius: 10px; background: var(--pi-surface); color: var(--pi-muted); font-size: 14px; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .context-session-edit-button.confirm { border-color: var(--pi-success-border); color: var(--pi-success); }
    .context-session-edit-button:hover, .context-session-edit-button:focus-visible { background: var(--pi-surface-hover); color: var(--pi-text-bright); }
    .context-session-edit-button:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    @media (prefers-reduced-motion: no-preference) {
      .context-session-edit-button.confirm:active { transform: scale(.94); }
    }
    /* Three dots like a messenger typing indicator: unmistakable at a glance,
       and the dots keep a visible static layout under reduced motion. */
    .context-working { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 3px; min-height: 32px; padding: 4px 8px; }
    .context-working-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--pi-accent, var(--pi-text-bright)); animation: context-working-bounce 1.2s ease-in-out infinite; }
    .context-working-dot:nth-child(2) { animation-delay: .2s; }
    .context-working-dot:nth-child(3) { animation-delay: .4s; }
    @keyframes context-working-bounce { 0%, 60%, 100% { transform: translateY(0); opacity: .55; } 30% { transform: translateY(-3px); opacity: 1; } }
    @media (prefers-reduced-motion: reduce) {
      .context-working-dot { animation: none; opacity: .8; }
    }
    .context-session-rename { flex: 0 0 auto; display: inline-grid; place-items: center; width: 32px; min-height: 32px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--pi-muted); font-size: 14px; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
    .context-session-rename:hover, .context-session-rename:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
    .context-session-rename:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 1px; }
    @media (pointer: coarse) { .context-session-rename { width: 34px; min-height: 34px; } }

    /* Shell styles do not cross a shadow boundary, so the tap-highlight
       suppression is repeated for components that define their own. */
    button, [role="button"], a, summary, label, input { -webkit-tap-highlight-color: transparent; }
    /* Keep the refresh menu in this shadow tree above the following mobile tab strip. */
    :host { position: relative; z-index: 20; flex: 0 0 auto; min-width: 0; }
    .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: flex; align-items: center; gap: 0; padding: 6px 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
    .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity .15s ease; }
    .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
    .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
    .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
    .context-bar-label { display: none; }
    .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: 5px; margin: 0; padding: 0 8px; list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
    .context-bar.has-context-actions .context-items { padding-right: 58px; scroll-padding-inline: 8px 58px; }
    .context-bar.has-context-actions-double .context-items { padding-right: 102px; scroll-padding-inline: 8px 102px; }
    .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
    .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; gap: 6px; padding: 0 8px; background: var(--pi-bg); pointer-events: none; }
    .context-actions::before { content: ""; position: absolute; top: 0; bottom: 0; left: -24px; z-index: 0; width: 24px; background: linear-gradient(90deg, transparent, var(--pi-bg)); pointer-events: none; }
    app-refresh-control, .context-action-button { position: relative; z-index: 1; pointer-events: auto; }
    .context-action-button { box-sizing: border-box; width: 36px; height: 36px; display: grid; place-items: center; border: 1px solid var(--pi-border); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text); padding: 0; line-height: 1; }
    .context-action-button:hover, .context-action-button:focus-visible { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    .context-action-icon { width: 18px; height: 18px; fill: currentColor; pointer-events: none; }
    /* The chips are the only way back to a list on a phone, so they get the
     comfortable tap height even though their text is one line. */
  .context-chip { flex: 0 0 auto; min-width: 0; min-height: 40px; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; border: 1px solid var(--pi-border-muted); border-radius: 999px; background: var(--pi-surface); color: var(--pi-text); padding: 4px 10px; font: inherit; text-align: left; }
    .context-chip:hover { background: var(--pi-surface-hover); }
    .context-chip:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: 2px; }
    .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
    .context-kind { display: none; }
    .context-breadcrumb {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 42%;
      overflow: hidden;
      border: 0;
      background: none;
      color: var(--pi-muted);
      min-height: 40px;
      box-sizing: border-box;
      padding: 4px 0 4px 8px;
      font: inherit;
      font-size: 11px;
      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .context-breadcrumb::after { content: "›"; padding: 0 2px 0 4px; }
    .context-breadcrumb:hover { color: var(--pi-text); }
    .context-session-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      border: 0;
      background: none;
      color: var(--pi-text-bright, var(--pi-text));
      padding: 4px 8px 4px 0;
      font: inherit;
      font-weight: 650;
      text-align: start;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: pointer;
    }
    .context-breadcrumb:focus-visible, .context-session-title:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -2px; }
    /* Session-led layout keeps the actions in flow rather than overlaying a
       scrolling chip strip that no longer exists. */
    .context-actions.inline { position: static; flex: 0 0 auto; }
    .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
    button { cursor: pointer; }
  `;
}

export function shouldShowMachineContext(machines: readonly Machine[]): boolean {
  return machines.length > 1;
}

function machineContextLabel(machine: Machine | undefined): string {
  return machine === undefined ? "No machine" : `${machine.name}${machine.kind === "remote" ? " · remote" : ""}`;
}

function machineContextTitle(machine: Machine | undefined): string {
  return machine === undefined ? "No machine selected" : machine.baseUrl ?? machine.name;
}

function projectContextLabel(project: Project | undefined): string {
  return project?.name ?? "No project";
}

function projectContextTitle(project: Project | undefined): string {
  return project === undefined ? "No project selected" : `${project.name} — ${project.path}`;
}

function workspaceContextLabel(workspace: Workspace | undefined): string {
  // Mobile needs the chip to stay one line tall; the full path still lives in
  // the title/secondary surfaces, while the chip itself keeps just the label.
  return workspace === undefined ? "No workspace" : `${workspace.label}${workspace.isMain ? " · main" : ""}`;
}

function workspaceContextTitle(workspace: Workspace | undefined): string {
  return workspace === undefined ? "No workspace selected" : `${workspace.label}${workspace.isMain ? " · main" : ""} — ${workspace.path}`;
}

/**
 * Condensed trail for the session-led layout: the most specific place that has
 * been chosen, qualified by its parent when that is not redundant.
 */
function breadcrumbLabel(
  workspace: Workspace | undefined,
  project: Project | undefined,
  machine: Machine | undefined,
  machines: readonly Machine[],
): string {
  const machinePrefix = shouldShowMachineContext(machines) && machine !== undefined ? `${machine.name} / ` : "";
  if (workspace !== undefined) {
    // A main workspace repeats its project's name, so naming both is noise.
    const label = workspace.isMain && project !== undefined ? project.name : workspace.label;
    return `${machinePrefix}${label}`;
  }
  if (project !== undefined) return `${machinePrefix}${project.name}`;
  return machinePrefix === "" ? "No workspace" : machinePrefix.replace(/ \/ $/u, "");
}

function breadcrumbTitle(workspace: Workspace | undefined, project: Project | undefined): string {
  if (workspace !== undefined) return workspace.path;
  if (project !== undefined) return project.path;
  return "No workspace selected";
}

function sessionContextLabel(session: SessionInfo | undefined): string {
  const name = session?.name?.trim();
  const firstMessage = session?.firstMessage.trim();
  return name !== undefined && name !== "" ? name : firstMessage !== undefined && firstMessage !== "" ? firstMessage : session === undefined ? "No session" : shortSessionId(session.id);
}

function sessionContextTitle(session: SessionInfo | undefined): string {
  return session === undefined ? "No session selected" : session.path;
}
