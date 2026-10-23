import { css, html, LitElement, type PropertyValues } from "lit";
import { renderHostCloseIcon } from "./hostUi";
import { property, query, state } from "lit/decorators.js";
import { styleMap, type StyleInfo } from "lit/directives/style-map.js";
import { Terminal, type ITerminalOptions, type ITheme } from "@xterm/xterm";
import { FitAddon, type ITerminalDimensions } from "@xterm/addon-fit";
import { xtermStyles } from "./xtermStyles.js";
import type { MachineTerminalSessions, TerminalCommandRun, TerminalInfo, Workspace, WorkspaceTerminalSessions } from "@gang-of-beads/pi-web/plugin-api";
import { selectFallbackTerminal, selectPreferredTerminal } from "./terminalChoice.js";
import { createTerminalCopySnapshot, DEFAULT_TERMINAL_ANSI_THEME, snapshotOffsetAt, wordRangeAt, type TerminalCopyRunStyle, type TerminalCopySnapshot, type TextRange } from "./terminalCopySnapshot.js";
import "./TerminalSoftKeys";
import type { TerminalSoftKeyInputOptions } from "./TerminalSoftKeys.js";
import { clampTerminalFontSize, pinchDistance, pinchFontSize, type PinchState } from "./pinchZoom.js";
import { describeTerminalError, terminalReadFailure } from "./hostUi.js";
import { adoptTerminalHostStyles, hostActionMenuPlacement, touchLayoutMedia } from "./hostUi.js";
import { FingerHold } from "./fingerHold.js";
import { keyBelongsToInputMethod } from "./inputMethodKey.js";
import { anyModifier, hardwareKeyInput, NO_MODIFIERS, toggledModifier, typedInput, type TerminalModifier, type TerminalModifiers } from "./terminalExtraKeys.js";
import { RECONNECTING_WORDS, terminalFailureWords, terminalRecovery, type TerminalOperation, type TerminalRecovery } from "./terminalRecovery.js";
import { softKeyboardShown } from "./softKeyboard.js";

const TERMINAL_OPTIONS_BASE: ITerminalOptions = {
  cursorBlink: true,
  convertEol: true,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 13,
};

const DEFAULT_TERMINAL_SIZE: TerminalSize = { cols: 100, rows: 30 };
/** The daemon's limit on a shell's name (terminalService.ts). */
const TERMINAL_NAME_MAX_LENGTH = 80;
const COMMAND_RUN_POLL_INTERVAL_MS = 1000;
// Surface backed up: the terminal command-run list. The lifecycle events are
// revisioned, but the panel predates that and still refreshes on this timer
// while a command run is active.

export class TerminalPanel extends LitElement {
  @property({ attribute: false }) workspace: Workspace | undefined;
  /**
   * Where the terminals live when they are not a workspace's: the global Terminal page passes the
   * machine's home folder scope (docs/design/go-to-scopes.md). A workspace's path otherwise.
   */
  @property() scopeFolder: string | undefined;
  @property() machineId = "local";
  @property({ attribute: false }) selectedTerminalId: string | undefined;
  @property({ type: Boolean }) autoStart = false;
  @property({ type: Boolean }) expanded = false;
  /** The pty capability this panel works through; the host binds its scope. */
  @property({ attribute: false }) sessions?: WorkspaceTerminalSessions | MachineTerminalSessions;
  @property({ attribute: false }) onSelectTerminal: (terminalId: string | undefined, options?: { replace?: boolean | undefined }) => void = () => undefined;
  /** Whether the host shows this page (`host.shown()`, r151): the shells are read, the screen opens and the command runs are polled only then. */
  @property({ type: Boolean }) shown = false;
  @query(".terminal-host") private terminalHost?: HTMLDivElement | null;
  /** Type size the terminal renders at; two fingers change it. See `pinchZoom`. */
  @state() private fontSize = TERMINAL_OPTIONS_BASE.fontSize ?? 13;
  private pinch: PinchState | undefined;
  @query(".terminal-copy-content") private terminalCopyContent?: HTMLPreElement | null;
  @query(".terminal-copy-selector") private terminalCopySelector?: HTMLTextAreaElement | null;
  @state() private terminals: TerminalInfo[] = [];
  @state() private commandRuns: TerminalCommandRun[] = [];
  @state() private selectedId: string | undefined;
  @state() private loading = false;
  /** A refusal a server stated, in its words, that the reader can act on (B48); never a request nobody answered. */
  @state() private refusal: string | undefined;
  /** The last request got no answer: the panel keeps what it knows and tries again by itself (B48). */
  @state() private reconnecting = false;
  @state() private cancellingRunIds: string[] = [];
  @state() private continuingTerminalIds: string[] = [];
  @state() private touchLayout = false;
  @state() private inputFocused = false;
  @state() private visibleHeight: number | undefined;
  @state() private modifiers: TerminalModifiers = NO_MODIFIERS;
  /** The selection layer: a snapshot of the screen whose text a finger selects as on any page. */
  @state() private copySnapshot: TerminalCopySnapshot | undefined;
  /** The live screen's font and row height, so the layer's text lies where the screen's did and the held word stays under the finger. */
  private copyLayerStyle: StyleInfo = {};
  /** The shell whose tab is a name field (R12): reached by a double-click, a held finger, F2, or Rename… in its right-click menu. */
  @state() private editingTerminalId: string | undefined;
  @state() private menuTerminalId: string | undefined;
  @state() private menuStyle = "";
  @query(".tab-name-input") private tabNameInput?: HTMLInputElement | null;
  private focusTabNameInput = false;
  private readonly tabHold = new FingerHold<string>((terminalId) => { this.editTerminalName(terminalId); });
  private readonly contentHold = new FingerHold<ScreenPoint>((point) => { this.selectWordAt(point); });
  /** Detects only a finger tap on the selection overlay (release() before the hold fires) to return to the live terminal; the hold itself does nothing and, as with FingerHold, a mouse press is ignored. */
  private readonly selectionTap = new FingerHold<undefined>(() => undefined);

  private terminal: Terminal | undefined;
  private fitAddon: FitAddon | undefined;
  private socket: WebSocket | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private themeObserver: MutationObserver | undefined;
  private suppressTerminalInput = false;
  private observedWorkspaceScope: string | undefined;
  private loadedCwd: string | undefined;
  private autoStartConsumedCwd: string | undefined;
  private commandRunPollTimer: number | undefined;
  private retryTimer: number | undefined;
  private retryAttempt = 0;
  /** A read was asked for while one was on its way, which may have begun before what it must see. */
  private readAgain = false;
  /** Closes and renames sent without an answer, resent while the shell list shows them not done. */
  private readonly unansweredCloses = new Set<string>();
  private readonly unansweredRenames = new Map<string, string>();
  private socketReopening = false;
  private readonly touchLayoutQuery = touchLayoutMedia();
  private readonly onTouchLayoutChange = (): void => {
    this.touchLayout = this.touchLayoutQuery?.matches === true;
  };
  private readonly onViewportResize = (): void => {
    this.visibleHeight = window.visualViewport?.height;
  };
  private readonly onSignOfLife = (): void => {
    if (document.visibilityState === "visible") this.retryNow();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    this.onTouchLayoutChange();
    this.onViewportResize();
    this.touchLayoutQuery?.addEventListener("change", this.onTouchLayoutChange);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
    document.addEventListener("visibilitychange", this.onSignOfLife);
    window.addEventListener("online", this.onSignOfLife);
    this.themeObserver = new MutationObserver(() => { this.applyTerminalTheme(); });
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  }

  override disconnectedCallback(): void {
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    this.touchLayoutQuery?.removeEventListener("change", this.onTouchLayoutChange);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    document.removeEventListener("visibilitychange", this.onSignOfLife);
    window.removeEventListener("online", this.onSignOfLife);
    this.clearRetry();
    this.updateCommandRunPolling(false);
    this.disposeTerminalView();
    super.disconnectedCallback();
  }

  private scheduleFitAfterLayout(): void {
    void this.updateComplete.then(() => {
      requestAnimationFrame(() => {
        this.fitAndNotify();
        this.terminal?.focus();
      });
    });
  }

  override willUpdate(changed: PropertyValues<this>): void {
    if (!this.selectedTerminalAcceptsInput() && anyModifier(this.modifiers)) this.modifiers = NO_MODIFIERS;
    const folder = this.folder();
    const workspaceScope = folder === undefined ? undefined : JSON.stringify([this.machineId, folder]);
    if (workspaceScope !== this.observedWorkspaceScope) {
      this.observedWorkspaceScope = workspaceScope;
      this.loadedCwd = undefined;
      this.autoStartConsumedCwd = undefined;
      this.terminals = [];
      this.commandRuns = [];
      this.selectedId = undefined;
      this.cancellingRunIds = [];
      this.continuingTerminalIds = [];
      this.editingTerminalId = undefined;
      this.menuTerminalId = undefined;
      this.refusal = undefined;
      this.reconnecting = false;
      this.retryAttempt = 0;
      this.clearRetry();
      this.unansweredCloses.clear();
      this.unansweredRenames.clear();
      this.updateCommandRunPolling(false);
      this.disposeTerminalView();
      return;
    }
    if (changed.has("selectedTerminalId")) {
      const previousTerminalId = changed.get("selectedTerminalId");
      if (previousTerminalId !== undefined && this.selectedTerminalId === undefined) {
        this.loadedCwd = undefined;
        this.selectTerminalIdInView(undefined);
        return;
      }
      this.applyRequestedTerminalSelection();
    }
  }

  override updated(changed: PropertyValues<this>): void {
    if (changed.has("expanded")) this.scheduleFitAfterLayout();
    if (!this.shown) this.updateCommandRunPolling(false);
    else if (this.hasPendingCommandRuns()) this.updateCommandRunPolling(true);
    this.loadVisibleWorkspaceTerminals();
    if (changed.has("selectedTerminalId") && this.shouldReloadForRequestedTerminal()) void this.loadTerminals();
    this.ensureTerminalView();
    if (this.focusTabNameInput && this.tabNameInput) {
      this.focusTabNameInput = false;
      this.tabNameInput.focus();
      this.tabNameInput.select();
    }
  }

  private loadVisibleWorkspaceTerminals(): void {
    const cwd = this.folder();
    if (!this.shown || cwd === undefined || cwd === this.loadedCwd) return;
    this.loadedCwd = cwd;
    void this.loadTerminals();
  }

  /**
   * Reads the shells and the command runs together. An answer for another scope than the one shown is
   * dropped. The auto-started shell is decided only by an answer: a read nobody answered must not use
   * up the start, and a start whose answer was lost is never repeated (`terminalRecovery`).
   */
  private async loadTerminals(): Promise<void> {
    const scope = this.observedWorkspaceScope;
    this.loading = true;
    this.refusal = undefined;
    try {
      if (this.folder() === undefined) return;
      const [terminals, commandRuns] = await Promise.all([
        this.terminalSessions().list(),
        this.listCommandRuns(),
      ]);
      if (scope !== this.observedWorkspaceScope) return;
      this.terminals = terminals;
      this.commandRuns = commandRuns;
      this.selectPreferredLoadedTerminal({ replaceUrl: true });
      this.updateCommandRunPolling(this.hasPendingCommandRuns(commandRuns));
      this.reconcileAfterListing();
      if (terminals.length === 0 && this.consumeAutoStart()) await this.startTerminal();
    } catch (error) {
      if (scope === this.observedWorkspaceScope) this.recover("list", error);
    } finally {
      this.loading = false;
      if (this.readAgain) {
        this.readAgain = false;
        void this.loadTerminals();
      }
    }
  }

  private readNow(): void {
    if (this.loading) {
      this.readAgain = true;
      return;
    }
    void this.loadTerminals();
  }

  /**
   * One failed request: the host says what the failure means (`ui.readFailure`), `terminalRecovery`
   * what this request does about it. `remember` keeps an idempotent write to resend.
   */
  private recover(operation: TerminalOperation, error: unknown, remember?: () => void): void {
    const failure = terminalReadFailure(error, this.retryAttempt);
    const delayMs = failure.kind === "retry" ? failure.delayMs : undefined;
    const executors: Readonly<Record<TerminalRecovery, () => void>> = {
      "retry-read": () => { this.scheduleRetry(delayMs); },
      reconcile: () => { this.readNow(); },
      "retry-write": () => {
        remember?.();
        this.scheduleRetry(delayMs);
      },
      "show-server-words": () => { this.refusal = terminalFailureWords(failure) ?? describeTerminalError(error); },
    };
    executors[terminalRecovery(operation, failure)]();
  }

  /** Reads again after the delay the host's `readFailure` gives and says "Reconnecting…" meanwhile. */
  private scheduleRetry(delayMs: number | undefined): void {
    this.reconnecting = true;
    if (this.retryTimer !== undefined) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = undefined;
      this.readNow();
    }, delayMs);
    this.retryAttempt += 1;
  }

  /** A sign of life (the tab shown, the browser online, the socket open) reads at once instead of waiting out the backoff. */
  private retryNow(): void {
    if (!this.reconnecting) return;
    this.clearRetry();
    this.readNow();
  }

  private clearRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** "Reconnecting…" goes once nothing is left waiting for an answer. */
  private settleReconnecting(): void {
    if (this.retryTimer !== undefined || this.socketReopening || this.unansweredCloses.size > 0 || this.unansweredRenames.size > 0) return;
    this.reconnecting = false;
    this.retryAttempt = 0;
  }

  /**
   * After the shell list answered: resend the closes and renames it shows not done, forget the ones it
   * shows done or moot, and reopen a dropped socket to a shell that still runs.
   */
  private reconcileAfterListing(): void {
    for (const id of this.unansweredCloses) {
      if (this.terminals.some((terminal) => terminal.id === id)) void this.closeTerminal(id);
      else this.unansweredCloses.delete(id);
    }
    for (const [id, name] of this.unansweredRenames) {
      const listed = this.terminals.find((terminal) => terminal.id === id);
      if (listed === undefined || listed.name === name) this.unansweredRenames.delete(id);
      else void this.renameTerminal(id, name);
    }
    this.reopenDroppedSocket();
    this.settleReconnecting();
  }

  private reopenDroppedSocket(): void {
    const terminal = this.terminal;
    const id = this.selectedId;
    if (terminal === undefined || id === undefined || this.socket !== undefined || !this.selectedTerminalAcceptsInput()) return;
    terminal.reset();
    this.socketReopening = this.connectSocket(id, terminal, this.fitTerminal());
  }

  private applyRequestedTerminalSelection(): void {
    if (this.selectedTerminalId !== undefined && !this.terminals.some((terminal) => terminal.id === this.selectedTerminalId)) return;
    this.selectPreferredLoadedTerminal({ replaceUrl: true });
  }

  private consumeAutoStart(): boolean {
    const cwd = this.folder();
    if (!this.autoStart || cwd === undefined || this.autoStartConsumedCwd === cwd) return false;
    this.autoStartConsumedCwd = cwd;
    return true;
  }

  private shouldReloadForRequestedTerminal(): boolean {
    const cwd = this.folder();
    return this.shown
      && cwd !== undefined
      && cwd === this.loadedCwd
      && this.selectedTerminalId !== undefined
      && !this.loading
      && !this.terminals.some((terminal) => terminal.id === this.selectedTerminalId);
  }

  private selectPreferredLoadedTerminal(options?: { replaceUrl?: boolean | undefined }): void {
    let terminal = selectPreferredTerminal(this.terminals, { targetTerminalId: this.selectedTerminalId });
    if (terminal === undefined && this.selectedTerminalId !== undefined) terminal = selectFallbackTerminal(this.terminals);
    this.selectTerminalIdInView(terminal?.id);
    if (terminal?.id !== this.selectedTerminalId || (terminal === undefined && this.selectedTerminalId !== undefined)) {
      this.onSelectTerminal(terminal?.id, { replace: options?.replaceUrl === true });
    }
  }

  private selectTerminalIdInView(id: string | undefined): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.modifiers = NO_MODIFIERS;
    this.disposeTerminalView();
  }

  private async startTerminal(): Promise<void> {
    if (this.folder() === undefined) return;
    this.refusal = undefined;
    try {
      const size = this.measureTerminalSize() ?? DEFAULT_TERMINAL_SIZE;
      const terminal = await this.terminalSessions().start(size);
      this.terminals = [...this.terminals, terminal];
      this.selectTerminal(terminal.id);
    } catch (error) {
      this.recover("start", error);
    }
  }

  private async closeTerminal(id: string): Promise<void> {
    try {
      if (this.folder() === undefined) return;
      await this.terminalSessions().close(id);
      this.unansweredCloses.delete(id);
      const next = this.terminals.filter((terminal) => terminal.id !== id);
      this.terminals = next;
      if (this.selectedId === id || this.selectedTerminalId === id) {
        const nextSelectedId = selectFallbackTerminal(next)?.id;
        this.selectTerminalIdInView(nextSelectedId);
        this.onSelectTerminal(nextSelectedId, { replace: true });
      }
      this.settleReconnecting();
    } catch (error) {
      this.unansweredCloses.delete(id);
      this.recover("close", error, () => { this.unansweredCloses.add(id); });
    }
  }

  private selectTerminal(id: string): void {
    if (this.selectedId !== id) this.selectTerminalIdInView(id);
    this.onSelectTerminal(id);
  }

  private editTerminalName(id: string): void {
    this.menuTerminalId = undefined;
    this.editingTerminalId = id;
    this.focusTabNameInput = true;
  }

  /**
   * Leave the name field, keeping what it holds. An empty or unchanged name changes nothing; the tab
   * shows the name the daemon answers with, never the typed text it may have refused.
   */
  private async commitTerminalName(id: string, value: string): Promise<void> {
    if (this.editingTerminalId !== id) return;
    this.editingTerminalId = undefined;
    const name = value.trim();
    const current = this.terminals.find((terminal) => terminal.id === id);
    if (current === undefined || name === "" || name === current.name) return;
    await this.renameTerminal(id, name);
  }

  private async renameTerminal(id: string, name: string): Promise<void> {
    try {
      const renamed = await this.terminalSessions().rename(id, name);
      this.unansweredRenames.delete(id);
      this.terminals = this.terminals.map((terminal) => terminal.id === renamed.id ? renamed : terminal);
      this.settleReconnecting();
    } catch (error) {
      this.unansweredRenames.delete(id);
      this.recover("rename", error, () => { this.unansweredRenames.set(id, name); });
    }
  }

  private onTerminalNameKeydown(event: KeyboardEvent, id: string): void {
    if (keyBelongsToInputMethod(event)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.editingTerminalId = undefined;
      return;
    }
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget instanceof HTMLInputElement) void this.commitTerminalName(id, event.currentTarget.value);
  }

  /**
   * A right-click on a tab opens its menu (the shell's name, Rename…, Close): the desktop's way to
   * them now that the tab has no ⋯. A finger's long-press only keeps the browser's own menu away,
   * because its hold already opened the name field, and some Android browsers send this event for the
   * same press. A host without a menu leaves the browser's.
   */
  private onTabContextMenu(id: string, event: MouseEvent): void {
    if (this.tabHold.fingerPressed() || pressedByFinger(event)) {
      event.preventDefault();
      return;
    }
    const place = hostActionMenuPlacement();
    if (place === undefined || !(event.currentTarget instanceof HTMLElement)) return;
    event.preventDefault();
    this.menuStyle = place(event.currentTarget);
    this.menuTerminalId = id;
  }

  private selectedTerminalInfo(): TerminalInfo | undefined {
    return this.terminals.find((terminal) => terminal.id === this.selectedId);
  }

  private selectedCommandRun(): TerminalCommandRun | undefined {
    const commandRunId = this.selectedTerminalInfo()?.commandRunId;
    if (commandRunId === undefined) return undefined;
    return this.commandRuns.find((run) => run.id === commandRunId);
  }

  private async loadCommandRuns(): Promise<void> {
    if (this.folder() === undefined) return;
    try {
      const commandRuns = await this.listCommandRuns();
      this.commandRuns = commandRuns;
      this.cancellingRunIds = this.cancellingRunIds.filter((runId) => commandRuns.some((run) => run.id === runId && isCommandRunPending(run)));
      this.updateCommandRunPolling(this.hasPendingCommandRuns(commandRuns));
    } catch (error) {
      this.recover("list", error);
    }
  }

  private updateCommandRunPolling(shouldPoll: boolean): void {
    if (shouldPoll && this.commandRunPollTimer === undefined) {
      // Surface backed up: the terminal command-run list (COMMAND_RUN_POLL_INTERVAL_MS).
      this.commandRunPollTimer = window.setInterval(() => { void this.loadCommandRuns(); }, COMMAND_RUN_POLL_INTERVAL_MS);
      return;
    }
    if (!shouldPoll && this.commandRunPollTimer !== undefined) {
      window.clearInterval(this.commandRunPollTimer);
      this.commandRunPollTimer = undefined;
    }
  }

  private hasPendingCommandRuns(commandRuns = this.commandRuns): boolean {
    return commandRuns.some(isCommandRunPending);
  }

  private async cancelCommandRun(run: TerminalCommandRun): Promise<void> {
    if (!isCommandRunPending(run) || this.cancellingRunIds.includes(run.id)) return;
    this.refusal = undefined;
    this.cancellingRunIds = [...this.cancellingRunIds, run.id];
    try {
      const sessions = this.terminalSessions();
      if ("cancelCommandRun" in sessions) await sessions.cancelCommandRun(run.id);
      await this.loadCommandRuns();
    } catch (error) {
      this.recover("cancel-run", error);
    } finally {
      this.cancellingRunIds = this.cancellingRunIds.filter((runId) => runId !== run.id);
    }
  }

  private async continueTerminal(id: string): Promise<void> {
    if (this.folder() === undefined || this.continuingTerminalIds.includes(id)) return;
    this.refusal = undefined;
    this.continuingTerminalIds = [...this.continuingTerminalIds, id];
    try {
      const terminal = await this.terminalSessions().continue(id);
      this.terminals = this.terminals.map((item) => item.id === id ? terminal : item);
      if (this.socket === undefined) this.disposeTerminalView();
      this.fitAndNotify();
      this.terminal?.focus();
    } catch (error) {
      this.recover("continue", error);
    } finally {
      this.continuingTerminalIds = this.continuingTerminalIds.filter((terminalId) => terminalId !== id);
    }
  }

  private readonly onPinchStart = (event: TouchEvent): void => {
    const distance = pinchDistance([...event.touches]);
    if (distance === undefined) return;
    this.pinch = { startDistance: distance, startFontSize: this.fontSize };
  };

  private readonly onPinchMove = (event: TouchEvent): void => {
    const state = this.pinch;
    if (state === undefined) return;
    const distance = pinchDistance([...event.touches]);
    if (distance === undefined) return;
    // The gesture belongs to the terminal: without this the page zooms and
    // the terminal scrolls out from under the fingers.
    event.preventDefault();
    const next = pinchFontSize(state, distance, this.fontSize);
    if (next === undefined) return;
    this.applyFontSize(next);
  };

  private readonly onPinchEnd = (): void => {
    this.pinch = undefined;
  };

  private applyFontSize(size: number): void {
    const next = clampTerminalFontSize(size);
    if (next === this.fontSize) return;
    this.fontSize = next;
    const terminal = this.terminal;
    if (terminal === undefined) return;
    terminal.options.fontSize = next;
    this.fitAndNotify();
  }

  private ensureTerminalView(): void {
    const terminalHost = this.terminalHostElement();
    if (!this.shown || this.terminal !== undefined || this.selectedId === undefined || terminalHost === undefined || this.folder() === undefined) return;
    const terminal = new Terminal({ ...terminalOptions(this), fontSize: this.fontSize });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalHost);
    this.terminal = terminal;
    this.fitAddon = fitAddon;
    this.resizeObserver = new ResizeObserver(() => { this.fitAndNotify(); });
    this.resizeObserver.observe(terminalHost);
    terminalHost.addEventListener("touchstart", this.onPinchStart, { passive: true });
    terminalHost.addEventListener("touchmove", this.onPinchMove, { passive: false });
    terminalHost.addEventListener("touchend", this.onPinchEnd, { passive: true });
    terminalHost.addEventListener("touchcancel", this.onPinchEnd, { passive: true });
    terminalHost.addEventListener("pointerdown", this.onContentPointerDown);
    terminalHost.addEventListener("pointermove", this.onContentPointerMove);
    terminalHost.addEventListener("pointerup", this.onContentPointerEnd);
    terminalHost.addEventListener("pointercancel", this.onContentPointerEnd);
    terminalHost.addEventListener("contextmenu", this.onContentContextMenu);
    terminalHost.addEventListener("focusin", this.onTerminalFocusIn);
    terminalHost.addEventListener("focusout", this.onTerminalFocusOut);
    terminal.onData((data) => {
      if (this.suppressTerminalInput || this.copySnapshot !== undefined) return;
      this.sendTypedInput(data);
    });
    const initialSize = this.fitTerminal();
    this.connectSocket(this.selectedId, terminal, initialSize);
    requestAnimationFrame(() => { this.fitAndNotify(); });
    terminal.focus();
  }

  /** Where these terminals live: the workspace's folder, or the scope the global page passed. */
  private folder(): string | undefined {
    return this.scopeFolder ?? this.workspace?.path;
  }

  /** Command runs are a workspace's; the machine's terminals have none. */
  private listCommandRuns(): Promise<TerminalCommandRun[]> {
    const sessions = this.terminalSessions();
    return "listCommandRuns" in sessions ? sessions.listCommandRuns() : Promise.resolve([]);
  }

  /**
   * The capability the host bound for this workspace, or one bound here from
   * the same properties. A panel never reaches past it to a route.
   */
  private terminalSessions(): WorkspaceTerminalSessions | MachineTerminalSessions {
    if (this.folder() === undefined) throw new Error("This panel has no folder to work in");
    if (this.sessions === undefined) throw new Error("This panel was given no terminal capability");
    return this.sessions;
  }

  /**
   * The shell's stream is a read like the list (B48). A connection that cannot be opened, or one that
   * drops while the shell still runs (a daemon or web restart, a lost link), says "Reconnecting…" and
   * reads the list again with backoff; the list's answer reopens it when the shell is still there
   * (`reopenDroppedSocket`). A connection that could not be opened used to escape into the update
   * cycle as an unhandled rejection, and then sat in red; one that dropped left a dead screen. A
   * socket the panel closed itself is no longer `this.socket` and is let go.
   */
  private connectSocket(terminalId: string, terminal: Terminal, initialSize: TerminalSize | undefined): boolean {
    let socket: WebSocket;
    try {
      socket = this.terminalSessions().connect(terminalId, initialSize);
    } catch (error) {
      this.recover("connect", error);
      return false;
    }
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    socket.addEventListener("open", () => {
      this.fitAndNotify();
      if (this.socket !== socket) return;
      this.socketReopening = false;
      this.retryNow();
    });
    socket.addEventListener("message", (event) => {
      void this.handleSocketMessage(event.data, terminalId, terminal);
    });
    socket.addEventListener("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.socketReopening = false;
      if (this.terminals.find((item) => item.id === terminalId)?.exited !== true) this.recover("connect", new Error("The terminal stream closed"));
    });
    return true;
  }

  private async handleSocketMessage(data: unknown, terminalId: string, terminal: Terminal): Promise<void> {
    try {
      const message = parseServerMessage(await socketDataToString(data));
      if (message.type === "output") {
        this.writeTerminalOutput(terminal, message.data, message.replay === true);
      }
      if (message.type === "exit") {
        terminal.writeln(`\r\n[process exited${message.exitCode === undefined ? "" : ` with code ${String(message.exitCode)}`}]`);
        this.terminals = this.terminals.map((item) => item.id === terminalId ? { ...item, exited: true, ...(message.exitCode === undefined ? {} : { exitCode: message.exitCode }) } : item);
        void this.loadCommandRuns();
      }
      if (message.type === "error") terminal.writeln(`\r\n[terminal error: ${message.message}]`);
    } catch (error) {
      terminal.writeln(`\r\n[terminal error: ${describeTerminalError(error)}]`);
    }
  }

  private writeTerminalOutput(terminal: Terminal, data: string, replay: boolean): void {
    if (!replay) {
      terminal.write(data);
      return;
    }
    this.suppressTerminalInput = true;
    terminal.write(data, () => {
      this.suppressTerminalInput = false;
    });
  }

  private fitAndNotify(): void {
    const size = this.fitTerminal();
    if (size === undefined) return;
    this.send({ type: "resize", ...size });
  }

  private fitTerminal(): TerminalSize | undefined {
    if (this.fitAddon === undefined || this.terminal === undefined) return undefined;
    const dimensions = this.fitAddon.proposeDimensions();
    const size = terminalSizeFromDimensions(dimensions);
    if (size === undefined) return undefined;
    this.fitAddon.fit();
    return size;
  }

  private measureTerminalSize(): TerminalSize | undefined {
    const currentSize = this.fitTerminal();
    if (currentSize !== undefined) return currentSize;
    const terminalHost = this.terminalHostElement();
    if (this.terminal !== undefined || terminalHost === undefined) return undefined;

    const measuringTerminal = new Terminal(terminalOptions(this));
    const measuringFitAddon = new FitAddon();
    measuringTerminal.loadAddon(measuringFitAddon);
    measuringTerminal.open(terminalHost);
    const size = terminalSizeFromDimensions(measuringFitAddon.proposeDimensions());
    measuringTerminal.dispose();
    return size;
  }

  private terminalHostElement(): HTMLDivElement | undefined {
    const terminalHost = this.terminalHost;
    return terminalHost instanceof HTMLDivElement ? terminalHost : undefined;
  }

  private applyTerminalTheme(): void {
    if (this.terminal !== undefined) this.terminal.options.theme = terminalTheme(this);
  }

  private sendTerminalInput(data: string): void {
    const filtered = filterTerminalInput(data);
    if (filtered !== "") this.send({ type: "input", data: filtered });
  }

  /** Typed text with the armed CTRL and ALT applied, as the phone's keyboard and xterm send it. */
  private sendTypedInput(data: string): void {
    const typed = typedInput(data, this.modifiers);
    this.modifiers = typed.modifiers;
    this.sendTerminalInput(typed.data);
  }

  /** An extra key pressed over a selection leaves it and still reaches the shell (owner, 2026-10-13). */
  private sendSoftKeyInput(data: string, options: TerminalSoftKeyInputOptions): void {
    this.leaveSelection();
    if (!options.repeat) this.modifiers = NO_MODIFIERS;
    this.sendTerminalInput(data);
    if (options.refocus) this.focusTerminal();
  }

  private toggleModifier(which: TerminalModifier): void {
    this.modifiers = toggledModifier(this.modifiers, which);
  }

  private focusTerminal(): void {
    const terminal = this.terminal;
    if (terminal === undefined) return;
    terminal.focus();
    requestAnimationFrame(() => { terminal.focus(); });
  }

  private send(message: { type: "input"; data: string } | { type: "resize"; cols: number; rows: number }): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private disposeTerminalView(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    const host = this.terminalHostElement();
    if (host !== undefined) {
      host.removeEventListener("touchstart", this.onPinchStart);
      host.removeEventListener("touchmove", this.onPinchMove);
      host.removeEventListener("touchend", this.onPinchEnd);
      host.removeEventListener("touchcancel", this.onPinchEnd);
      host.removeEventListener("pointerdown", this.onContentPointerDown);
      host.removeEventListener("pointermove", this.onContentPointerMove);
      host.removeEventListener("pointerup", this.onContentPointerEnd);
      host.removeEventListener("pointercancel", this.onContentPointerEnd);
      host.removeEventListener("contextmenu", this.onContentContextMenu);
      host.removeEventListener("focusin", this.onTerminalFocusIn);
      host.removeEventListener("focusout", this.onTerminalFocusOut);
    }
    this.pinch = undefined;
    this.contentHold.cancel();
    this.inputFocused = false;
    this.socket?.close();
    this.socket = undefined;
    this.terminal?.dispose();
    this.terminal = undefined;
    this.fitAddon = undefined;
    this.copySnapshot = undefined;
  }

  private renderCommandRunNotice() {
    const run = this.selectedCommandRun();
    if (run === undefined) return null;
    const terminal = this.selectedTerminalInfo();
    if (isCommandRunPending(run)) {
      const cancelling = this.cancellingRunIds.includes(run.id);
      return html`
        <section class="command-run-notice running">
          <div>
            <strong>${run.title}</strong>
            <p>Command is running. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> or use the button to cancel.</p>
            <code>${run.command}</code>
          </div>
          <button class="danger" ?disabled=${cancelling} @click=${() => { void this.cancelCommandRun(run); }}>${cancelling ? "Cancel sent…" : "Cancel command"}</button>
        </section>
      `;
    }
    if (terminal?.exited === true) {
      const continuing = this.continuingTerminalIds.includes(terminal.id);
      return html`
        <section class=${`command-run-notice ${run.status}`}>
          <div>
            <strong>${commandRunCompletionLabel(run)}</strong>
            <p>Output is preserved. Continue in a shell to inspect or run follow-up commands.</p>
            <code>${run.command}</code>
          </div>
          <button ?disabled=${continuing} @click=${() => { void this.continueTerminal(terminal.id); }}>${continuing ? "Starting shell…" : "Continue in shell"}</button>
        </section>
      `;
    }
    return null;
  }

  /**
   * A finger held on the terminal's text selects the word under it, as on any page (owner,
   * 2026-10-13). The live screen cannot be selected natively (iOS offsets selection in a scrolled
   * container, see `syncCopySnapshotScroll`), so the hold lays the snapshot over it, with the system's
   * handles and Copy menu on its text. The finger is mapped to the buffer cell before the layer
   * covers the screen. A browser that follows the hold with a tap's mouse events would land that
   * mousedown on the new layer and collapse the word to a caret, so the first one is refused.
   */
  private selectWordAt(point: ScreenPoint): void {
    const terminal = this.terminal;
    if (terminal === undefined || this.copySnapshot !== undefined) return;
    this.captureCopySnapshot(terminal, terminalCellAt(terminal, point));
  }

  private captureCopySnapshot(terminal: Terminal, cell: TerminalCell | undefined): void {
    const buffer = terminal.buffer.active;
    const snapshot = createTerminalCopySnapshot(buffer, terminal.cols, {
      theme: terminal.options.theme,
      drawBoldTextInBrightColors: terminal.options.drawBoldTextInBrightColors,
    });
    const word: TextRange | undefined = cell === undefined ? undefined : wordRangeAt(snapshot.text, snapshotOffsetAt(snapshot, buffer, cell.line, cell.column));
    this.copyLayerStyle = terminalTextMetrics(terminal);
    this.copySnapshot = snapshot;
    terminal.blur();
    void this.updateComplete.then(() => {
      const selector = this.terminalCopySelector;
      if (selector === null || selector === undefined) return;
      const sourceScrollRange = Math.max(0, snapshot.physicalLineCount - terminal.rows);
      const sourceScrollTop = Math.min(sourceScrollRange, snapshot.viewportLine);
      const scrollRatio = sourceScrollRange === 0 ? 0 : sourceScrollTop / sourceScrollRange;
      selector.scrollTop = scrollRatio * Math.max(0, selector.scrollHeight - selector.clientHeight);
      if (word !== undefined) {
        selector.focus({ preventScroll: true });
        selector.setSelectionRange(word.start, word.end);
      }
      this.syncCopySnapshotScroll();
    });
  }

  private exitCopyMode(): void {
    this.selectionTap.cancel();
    this.copySnapshot = undefined;
  }

  /** Leaves the selection for the live screen at its cursor, where the next key's echo lands. */
  private leaveSelection(): void {
    if (this.copySnapshot === undefined) return;
    this.exitCopyMode();
    this.terminal?.scrollToBottom();
  }

  /**
   * A tap on the selection returns to the live terminal and does what a tap on it does: focuses its
   * input. The layer is taken down synchronously (`performUpdate`), because the input cannot take
   * focus while the screen is still inert, and iOS raises its keyboard only for a focus inside the tap.
   */
  private returnToLiveTerminal(): void {
    this.leaveSelection();
    this.performUpdate();
    this.terminal?.focus();
  }

  /**
   * A hardware key pressed over a selection goes to the shell (owner, 2026-10-13): it leaves the
   * selection, sends the key, and hands the input back to xterm for the keys after it. The shortcuts
   * that act on the selection stay the browser's: Cmd with any key, and Ctrl+C while text is selected.
   */
  private onSelectionKeydown(event: KeyboardEvent): void {
    if (keyBelongsToInputMethod(event) || event.metaKey || copiesSelection(event)) return;
    const data = hardwareKeyInput(event, this.terminal?.modes);
    if (data === undefined) return;
    event.preventDefault();
    this.returnToLiveTerminal();
    this.sendTypedInput(data);
  }

  // iOS WebKit offsets native selection hit-testing in a scrolled generic
  // overflow container. A textarea owns selection and scrolling while the
  // synchronized, noninteractive pre preserves the terminal's ANSI styling.
  // Keep its caret visible: iOS hides native selection handles with the caret.
  private syncCopySnapshotScroll(): void {
    const selector = this.terminalCopySelector;
    const content = this.terminalCopyContent;
    if (selector === null || selector === undefined || content === null || content === undefined) return;
    const selectorVerticalRange = Math.max(0, selector.scrollHeight - selector.clientHeight);
    const contentVerticalRange = Math.max(0, content.scrollHeight - content.clientHeight);
    const selectorHorizontalRange = Math.max(0, selector.scrollWidth - selector.clientWidth);
    const contentHorizontalRange = Math.max(0, content.scrollWidth - content.clientWidth);
    content.scrollTop = normalizedScrollOffset(selector.scrollTop, selectorVerticalRange, contentVerticalRange);
    content.scrollLeft = normalizedScrollOffset(selector.scrollLeft, selectorHorizontalRange, contentHorizontalRange);
  }

  private renderCopyMode() {
    const snapshot = this.copySnapshot;
    if (snapshot === undefined) return null;
    return html`
      <section class="terminal-copy-view" aria-label="Terminal text selection">
        <div class="terminal-copy-layers" style=${styleMap(this.copyLayerStyle)}>
          <pre class="terminal-copy-content" aria-hidden="true">${snapshot.lines.map((line, index) => html`${index === 0 ? null : "\n"}${line.runs.map((run) => html`<span style=${styleMap(terminalCopyRunStyle(run.style))}>${run.text}</span>`)}`)}</pre>
          <textarea
            class="terminal-copy-selector"
            readonly
            inputmode="none"
            wrap="soft"
            spellcheck="false"
            autocapitalize="off"
            autocomplete="off"
            aria-label="Selectable terminal output"
            .value=${snapshot.text}
            @scroll=${() => { this.syncCopySnapshotScroll(); }}
            @pointerdown=${(event: PointerEvent) => { this.selectionTap.start(event, undefined); }}
            @pointermove=${(event: PointerEvent) => { this.selectionTap.move(event); }}
            @pointerup=${() => { if (this.selectionTap.release()) this.returnToLiveTerminal(); }}
            @pointercancel=${() => { this.selectionTap.cancel(); }}
            @mousedown=${(event: MouseEvent) => { if (this.contentHold.consumeClick()) event.preventDefault(); }}
            @keydown=${(event: KeyboardEvent) => { this.onSelectionKeydown(event); }}
          ></textarea>
        </div>
      </section>
    `;
  }

  private selectedTerminalAcceptsInput(): boolean {
    const terminal = this.selectedTerminalInfo();
    return terminal !== undefined && !terminal.exited;
  }

  private renderDockedSoftKeys() {
    return this.selectedTerminalAcceptsInput() ? this.renderSoftKeys() : null;
  }

  /**
   * The floating key that raises the phone's keyboard (owner, 2026-10-13), as ttyd and VS Code's web
   * terminal leave the keyboard to one control: it focuses the terminal's input, and is gone while the
   * keyboard is up, whose own key closes it. Touch and narrow layouts only, like the extra keys; not
   * over a selection or for an exited shell. The press keeps the focus where it is, and the click
   * blurs before focusing, so a keyboard closed by Android's back gesture over a focused input opens.
   */
  private renderKeyboardToggle() {
    if (this.copySnapshot !== undefined || !this.selectedTerminalAcceptsInput()) return null;
    if (softKeyboardShown(this.inputFocused, this.visibleHeight, window.screen.height)) return null;
    return html`
      <button
        type="button"
        class="keyboard-toggle"
        title="Show keyboard"
        aria-label="Show keyboard"
        @pointerdown=${(event: PointerEvent) => { event.preventDefault(); }}
        @click=${() => { this.raiseKeyboard(); }}
      >
        <svg class="keyboard-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="3" y="5" width="18" height="14" rx="2"></rect>
          <path d="M7 9h.01M10 9h.01M13 9h.01M16 9h.01M7 12h.01M10 12h.01M13 12h.01M16 12h.01M8 16h8"></path>
        </svg>
      </button>
    `;
  }

  private raiseKeyboard(): void {
    const terminal = this.terminal;
    if (terminal === undefined) return;
    terminal.blur();
    terminal.focus();
  }

  private renderSoftKeys() {
    return html`
      <terminal-soft-keys
        .modes=${this.terminal?.modes}
        .modifiers=${this.modifiers}
        .refocusOnClick=${!this.touchLayout}
        .onInput=${(data: string, options: TerminalSoftKeyInputOptions) => { this.sendSoftKeyInput(data, options); }}
        .onModifier=${(which: TerminalModifier) => { this.toggleModifier(which); }}
      ></terminal-soft-keys>
    `;
  }

  /** At most a quiet "Reconnecting…" while an answer is awaited (B48), never an error. */
  private renderReadStatus() {
    if (this.reconnecting) return html`<p class="muted" role="status">${RECONNECTING_WORDS}</p>`;
    return this.loading ? html`<p class="muted">Loading terminals…</p>` : null;
  }

  override render() {
    return html`
      <section class="terminal-shell">
        <div class="terminal-tabs">
          ${this.terminals.map((terminal) => this.renderTab(terminal))}
          <button class="new" ?disabled=${this.folder() === undefined} @click=${() => { void this.startTerminal(); }}>+ Shell</button>
        </div>
        ${this.refusal === undefined ? null : html`<p class="error">${this.refusal}</p>`}
        ${this.renderCommandRunNotice()}
        ${this.renderReadStatus()}
        <div class="terminal-stage">
          <div class=${this.copySnapshot === undefined ? "terminal-host" : "terminal-host copying"} ?inert=${this.copySnapshot !== undefined}></div>
          ${this.renderCopyMode()}
          ${this.renderKeyboardToggle()}
        </div>
        ${this.renderDockedSoftKeys()}
        ${this.renderTabMenu()}
      </section>
    `;
  }

  private renderTab(terminal: TerminalInfo) {
    if (this.editingTerminalId === terminal.id) return this.renderTabNameEditor(terminal);
    return html`
      <button
        class=${this.selectedId === terminal.id ? "tab selected" : "tab"}
        aria-keyshortcuts="F2"
        @click=${() => { if (!this.tabHold.consumeClick()) this.selectTerminal(terminal.id); }}
        @dblclick=${() => { this.editTerminalName(terminal.id); }}
        @keydown=${(event: KeyboardEvent) => { if (event.key === "F2") { event.preventDefault(); this.editTerminalName(terminal.id); } }}
        @pointerdown=${(event: PointerEvent) => { if (!onTabClose(event)) this.tabHold.start(event, terminal.id); }}
        @pointermove=${(event: PointerEvent) => { this.tabHold.move(event); }}
        @pointerup=${() => { this.tabHold.cancel(); }}
        @pointercancel=${() => { this.tabHold.cancel(); }}
        @contextmenu=${(event: MouseEvent) => { this.onTabContextMenu(terminal.id, event); }}
      >
        <span>${terminal.name}${terminal.exited ? " · exited" : ""}</span>
        <small @click=${(event: Event) => { event.stopPropagation(); void this.closeTerminal(terminal.id); }}>${renderHostCloseIcon()}</small>
      </button>
    `;
  }

  private renderTabNameEditor(terminal: TerminalInfo) {
    return html`
      <div class=${this.selectedId === terminal.id ? "tab-editing selected" : "tab-editing"}>
        <input
          class="tab-name-input"
          .value=${terminal.name}
          maxlength=${TERMINAL_NAME_MAX_LENGTH}
          aria-label=${`Name for ${terminal.name}`}
          enterkeyhint="done"
          autocomplete="off"
          spellcheck="false"
          @keydown=${(event: KeyboardEvent) => { this.onTerminalNameKeydown(event, terminal.id); }}
          @blur=${(event: FocusEvent) => { if (event.currentTarget instanceof HTMLInputElement) void this.commitTerminalName(terminal.id, event.currentTarget.value); }}
        >
      </div>
    `;
  }

  /** The tab's right-click menu, the host's own (R12 option A): the shell's name, then Rename… and Close. */
  private renderTabMenu() {
    const terminal = this.terminals.find((candidate) => candidate.id === this.menuTerminalId);
    if (terminal === undefined) return null;
    return html`
      <div class="menu-scrim" @click=${() => { this.menuTerminalId = undefined; }}></div>
      <div class="action-menu-panel" role="menu" aria-label=${`Actions for ${terminal.name}`} style=${this.menuStyle} @keydown=${(event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); this.menuTerminalId = undefined; } }}>
        <p class="action-menu-subject">${terminal.name}</p>
        <button type="button" role="menuitem" @click=${() => { this.editTerminalName(terminal.id); }}>Rename…</button>
        <button type="button" role="menuitem" @click=${() => { this.menuTerminalId = undefined; void this.closeTerminal(terminal.id); }}>Close</button>
      </div>
    `;
  }

  private readonly onContentPointerDown = (event: PointerEvent): void => {
    this.contentHold.start(event, { x: event.clientX, y: event.clientY });
  };

  private readonly onContentPointerMove = (event: PointerEvent): void => {
    this.contentHold.move(event);
  };

  private readonly onContentPointerEnd = (): void => {
    this.contentHold.cancel();
  };

  /** A held finger selects; the platform's own long-press menu would cover the selection. */
  private readonly onContentContextMenu = (event: Event): void => {
    if (this.contentHold.fingerPressed()) event.preventDefault();
  };

  private readonly onTerminalFocusIn = (event: FocusEvent): void => {
    this.inputFocused = event.target === this.terminal?.textarea;
  };

  private readonly onTerminalFocusOut = (): void => {
    this.inputFocused = false;
  };

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();
    if (root instanceof ShadowRoot) adoptTerminalHostStyles(root);
    return root;
  }

  static override styles = [xtermStyles, css`
    :host { flex: 1 1 auto; min-height: 0; display: flex; }
    .terminal-shell { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--pi-terminal-bg); }
    .terminal-tabs { flex: 0 0 auto; display: flex; gap: var(--pi-space-3); align-items: center; padding: var(--pi-space-3); border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); overflow: auto; }
    .terminal-tabs > button { box-sizing: border-box; flex: 0 0 auto; height: var(--pi-control-height); line-height: 16px; }
    /* Desktop xterm already has mouse selection and hardware keys; keep touch controls to touch/narrow layouts. */
    .keyboard-toggle, terminal-soft-keys { display: none; }
    @media (pointer: coarse), (max-width: 760px) {
      .terminal-tabs > button { height: var(--pi-control-height-touch); }
      .keyboard-toggle { display: grid; }
      terminal-soft-keys { display: block; }
    }
    button { display: inline-flex; align-items: center; gap: var(--pi-space-3); min-width: 0; max-width: 180px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); cursor: pointer; }
    button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
    button.new { flex: 0 0 auto; color: var(--pi-muted); }
    .keyboard-toggle { position: absolute; right: var(--pi-space-4); bottom: var(--pi-space-4); z-index: var(--pi-layer-raised); box-sizing: border-box; width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); place-items: center; padding: 0; border-radius: var(--pi-radius-lg); background: var(--pi-bg-overlay-soft, var(--pi-surface)); }
    .keyboard-toggle .keyboard-icon { display: block; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
    button span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    button small { color: var(--pi-muted); font-size: var(--pi-text-base); line-height: 1; }
    .terminal-tabs > button { -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
    .terminal-tabs > button.tab { gap: var(--pi-space-1); padding-inline-end: 0; }
    .tab-editing { box-sizing: border-box; flex: 0 0 auto; display: inline-flex; align-items: center; height: var(--pi-control-height); padding: var(--pi-space-1); border: 1px solid var(--pi-accent); border-radius: var(--pi-radius-md); background: var(--pi-selection-bg); }
    .tab-name-input { box-sizing: border-box; width: 160px; max-width: 40vw; height: 100%; padding: 0 var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-bg); color: var(--pi-text); font: inherit; }
    @media (pointer: coarse), (max-width: 760px) {
      .tab-editing { height: var(--pi-control-height-touch); }
    }
    .action-menu-panel button { max-width: none; }
    @media (hover: hover) { button small:hover { color: var(--pi-danger); } }
    .terminal-tabs > button small { align-self: stretch; display: inline-grid; place-items: center; min-width: 24px; margin-block: calc(-1 * var(--pi-space-3)); }
    @media (pointer: coarse) {
      .terminal-tabs > button small { min-width: var(--pi-control-height-touch); }
      .terminal-tabs > button { max-width: 220px; }
    }
    button.danger { color: var(--pi-danger); }
    button:disabled { opacity: var(--pi-disabled-opacity); cursor: not-allowed; }
    .command-run-notice { flex: 0 0 auto; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--pi-space-5); align-items: center; padding: var(--pi-space-4) var(--pi-space-5); border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-surface); color: var(--pi-text); }
    .command-run-notice.running { border-color: var(--pi-warning-border); }
    .command-run-notice.succeeded { border-color: var(--pi-success-border); }
    .command-run-notice.failed { border-color: var(--pi-danger); }
    .command-run-notice p { margin: var(--pi-space-2) 0; color: var(--pi-muted); }
    .command-run-notice code { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-text-secondary); font: var(--pi-text-xs) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; }
    .command-run-notice kbd { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-xs); background: var(--pi-bg); padding: 0 var(--pi-space-2); font: var(--pi-text-2xs) var(--pi-font-mono, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace); line-height: inherit; }
    .command-run-notice button { justify-self: end; max-width: none; }
    .terminal-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; background: var(--pi-terminal-bg); }
    .terminal-host { position: absolute; inset: 0; padding: var(--pi-space-3); box-sizing: border-box; overflow: hidden; -webkit-touch-callout: none; }
    .terminal-host.copying { visibility: hidden; pointer-events: none; }
    .terminal-copy-view { position: absolute; inset: 0; display: flex; flex-direction: column; min-height: 0; background: var(--pi-terminal-bg); color: var(--pi-terminal-text); }
    .terminal-copy-layers { flex: 1 1 auto; min-height: 0; display: grid; overflow: hidden; background: var(--pi-terminal-bg); }
    .terminal-copy-content, .terminal-copy-selector { grid-area: 1 / 1; box-sizing: border-box; min-width: 0; min-height: 0; width: 100%; height: 100%; margin: 0; padding: var(--pi-space-3); border: 0; border-radius: 0; font-family: var(--terminal-copy-font-family, monospace); font-size: var(--terminal-copy-font-size, var(--pi-text-sm)); line-height: var(--terminal-copy-line-height, 17px); letter-spacing: normal; font-variant-ligatures: none; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-all; }
    .terminal-copy-content { overflow: auto; pointer-events: none; background: var(--pi-terminal-bg); color: var(--pi-terminal-text); -webkit-user-select: none; user-select: none; }
    .terminal-copy-selector { z-index: 1; overflow: auto; resize: none; outline: none; appearance: none; background: transparent; color: transparent; caret-color: var(--pi-accent); -webkit-text-fill-color: transparent; cursor: text; -webkit-user-select: text; user-select: text; -webkit-touch-callout: default; touch-action: auto; }
    /* The selector's text is transparent and the styled pre shows through it, so its highlight must be translucent too: an opaque one hid the selected characters (owner, 2026-10-13). iOS draws its own translucent tint and ignores this. */
    .terminal-copy-selector::selection { background: color-mix(in srgb, var(--pi-accent) 35%, transparent); color: transparent; -webkit-text-fill-color: transparent; }
    .terminal-host .xterm { height: 100%; cursor: text; position: relative; user-select: none; }
    .terminal-host .xterm.focus, .terminal-host .xterm:focus { outline: none; }
    .terminal-host .xterm-helpers { position: absolute; top: 0; z-index: 5; }
    /* Hide the helper textarea without using !important on the positional properties (left/top/width/height/z-index). xterm sets those inline during IME/dead-key composition (e.g. "~" on a Swedish layout) so the composition is positioned at the cursor and committed correctly; forcing them here would pin the textarea off-screen with zero size and break composition. */
    .terminal-host .xterm-helper-textarea { box-sizing: border-box; position: absolute; left: -9999em; top: 0; width: 0; height: 0; padding: 0 !important; border: 0 !important; margin: 0 !important; opacity: 0 !important; z-index: -5; white-space: nowrap !important; overflow: hidden !important; resize: none !important; outline: 0 !important; appearance: none !important; }
    /* The composition view shows pending dead-key/IME input. Without these rules it renders as a static block in the top-left corner instead of overlaying the cursor. */
    .terminal-host .composition-view { position: absolute; display: none; white-space: nowrap; z-index: 1; background: var(--pi-terminal-bg, #000); color: var(--pi-terminal-text, #fff); }
    .terminal-host .composition-view.active { display: block; }
    /* xterm draws its own scrollbar into the element it scrolls, so asking for
       a permanent one here painted a second, native bar beside it on any
       platform with classic scrollbars. Measured: this viewport's scrollHeight
       equals its clientHeight, so that bar was an empty track scrolling
       nothing. Letting it be automatic keeps a bar available if this element ever
       does overflow, without reserving one that never moves. */
    .terminal-host .xterm-viewport { position: absolute; inset: 0; overflow-y: auto; cursor: default; background-color: var(--pi-terminal-bg); }
    .terminal-host .xterm-screen { position: relative; }
    .terminal-host .xterm-screen canvas { position: absolute; left: 0; top: 0; }
    .terminal-host .xterm-char-measure-element { display: inline-block; visibility: hidden; position: absolute; top: 0; left: -9999em; line-height: normal; }
    .terminal-host .xterm-accessibility:not(.debug), .terminal-host .xterm-message { position: absolute; inset: 0; z-index: var(--pi-layer-raised); color: transparent; pointer-events: none; }
    .terminal-host .xterm-accessibility-tree:not(.debug) *::selection { color: transparent; }
    .terminal-host .xterm-accessibility-tree { font-family: monospace; user-select: text; white-space: pre; }
    .terminal-host .xterm-accessibility-tree > div { transform-origin: left; width: fit-content; }
    .terminal-host .live-region { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
    .error { flex: 0 0 auto; margin: 0; padding: var(--pi-space-4); color: var(--pi-danger); border-bottom: 1px solid var(--pi-border); background: var(--pi-surface); }
    .muted { margin: var(--pi-space-5); color: var(--pi-muted); }
    .xterm { height: 100%; }
  `];
}

/** Whether a press began on a tab's ×, which acts on its click: holding it is not a rename. */
function onTabClose(event: PointerEvent): boolean {
  return event.target instanceof Element && event.target.closest("small") !== null;
}

function pressedByFinger(event: MouseEvent): boolean {
  return typeof PointerEvent !== "undefined" && event instanceof PointerEvent && (event.pointerType === "touch" || event.pointerType === "pen");
}

/** Ctrl+C over selected text copies it, as a desktop terminal does; without a selection it is the shell's interrupt. */
function copiesSelection(event: KeyboardEvent): boolean {
  const target = event.currentTarget;
  return event.ctrlKey && !event.altKey && event.key.toLowerCase() === "c" && target instanceof HTMLTextAreaElement && target.selectionStart !== target.selectionEnd;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface TerminalCell {
  line: number;
  column: number;
}

function terminalTextMetrics(terminal: Terminal): StyleInfo {
  const screen = terminal.element?.querySelector(".xterm-screen");
  const rowHeight = screen instanceof HTMLElement && terminal.rows > 0 ? screen.getBoundingClientRect().height / terminal.rows : undefined;
  return {
    "--terminal-copy-font-family": terminal.options.fontFamily,
    "--terminal-copy-font-size": `${String(terminal.options.fontSize)}px`,
    "--terminal-copy-line-height": rowHeight === undefined || rowHeight <= 0 ? undefined : `${String(rowHeight)}px`,
  };
}

/** The buffer cell under a point on the live screen, measured from xterm's screen element and its grid. */
function terminalCellAt(terminal: Terminal, point: ScreenPoint): TerminalCell | undefined {
  const screen = terminal.element?.querySelector(".xterm-screen");
  if (!(screen instanceof HTMLElement) || terminal.cols <= 0 || terminal.rows <= 0) return undefined;
  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return undefined;
  const column = Math.min(terminal.cols - 1, Math.max(0, Math.floor((point.x - rect.left) / (rect.width / terminal.cols))));
  const row = Math.min(terminal.rows - 1, Math.max(0, Math.floor((point.y - rect.top) / (rect.height / terminal.rows))));
  return { line: terminal.buffer.active.viewportY + row, column };
}

function normalizedScrollOffset(sourceOffset: number, sourceRange: number, targetRange: number): number {
  if (sourceRange <= 0 || targetRange <= 0) return 0;
  return Math.min(1, Math.max(0, sourceOffset / sourceRange)) * targetRange;
}

function dimTerminalCopyColor(color: string): string {
  return /^#[\da-f]{6}$/i.test(color) ? `${color}80` : `color-mix(in srgb, ${color} 50%, transparent)`;
}

function terminalCopyRunStyle(style: TerminalCopyRunStyle): StyleInfo {
  const decorations = [
    style.underline ? "underline" : undefined,
    style.strikethrough ? "line-through" : undefined,
    style.overline ? "overline" : undefined,
  ].filter((decoration): decoration is string => decoration !== undefined).join(" ");
  return {
    color: style.invisible ? "transparent" : style.dim ? dimTerminalCopyColor(style.foreground) : style.foreground,
    backgroundColor: style.background,
    fontWeight: style.bold ? "700" : undefined,
    fontStyle: style.italic ? "italic" : undefined,
    textDecorationLine: decorations === "" ? undefined : decorations,
  };
}

interface TerminalSize {
  cols: number;
  rows: number;
}

type ServerTerminalMessage =
  | { type: "output"; data: string; replay?: boolean }
  | { type: "exit"; exitCode?: number }
  | { type: "error"; message: string };

function isCommandRunPending(run: TerminalCommandRun): boolean {
  return run.status === "queued" || run.status === "running";
}

function commandRunCompletionLabel(run: TerminalCommandRun): string {
  if (run.status === "succeeded") return `Command succeeded${run.exitCode === undefined ? "" : ` with exit code ${String(run.exitCode)}`}`;
  return `Command failed${run.exitCode === undefined ? "" : ` with exit code ${String(run.exitCode)}`}`;
}

function parseServerMessage(data: string): ServerTerminalMessage {
  const value: unknown = JSON.parse(data);
  if (!isRecord(value)) return { type: "error", message: "Invalid terminal message" };
  const record = value;
  if (record["type"] === "output" && typeof record["data"] === "string") return { type: "output", data: record["data"], ...(typeof record["replay"] === "boolean" ? { replay: record["replay"] } : {}) };
  if (record["type"] === "exit") return { type: "exit", ...(typeof record["exitCode"] === "number" ? { exitCode: record["exitCode"] } : {}) };
  if (record["type"] === "error" && typeof record["message"] === "string") return { type: "error", message: record["message"] };
  return { type: "error", message: "Invalid terminal message" };
}

export function filterTerminalInput(data: string): string {
  // Xterm can emit focus-in/focus-out sequences when replayed output leaves focus
  // tracking enabled. Bash/readline treats those sequences as typed text, which
  // leaves stray characters on the prompt after reconnecting to an active shell.
  return data.replaceAll("\x1b[I", "").replaceAll("\x1b[O", "");
}

async function socketDataToString(data: unknown): Promise<string> {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Blob) return await data.text();
  return String(data);
}

function terminalOptions(element: HTMLElement): ITerminalOptions {
  return { ...TERMINAL_OPTIONS_BASE, theme: terminalTheme(element) };
}

function terminalTheme(element: HTMLElement): ITheme {
  return {
    ...DEFAULT_TERMINAL_ANSI_THEME,
    background: themeColor(element, "--pi-terminal-bg", "#05070a"),
    foreground: themeColor(element, "--pi-terminal-text", "#e6edf3"),
    cursor: themeColor(element, "--pi-accent", "#58a6ff"),
    selectionBackground: themeColor(element, "--pi-terminal-selection", "#264f78"),
  };
}

function themeColor(element: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

function terminalSizeFromDimensions(dimensions: ITerminalDimensions | undefined): TerminalSize | undefined {
  if (dimensions === undefined || !isValidTerminalSize(dimensions.cols, dimensions.rows)) return undefined;
  return { cols: Math.floor(dimensions.cols), rows: Math.floor(dimensions.rows) };
}

function isValidTerminalSize(cols: number, rows: number): boolean {
  return Number.isFinite(cols) && Number.isFinite(rows) && cols > 0 && rows > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

if (customElements.get("terminal-panel") === undefined) customElements.define("terminal-panel", TerminalPanel);
