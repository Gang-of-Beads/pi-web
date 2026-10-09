import type { ExtensionUiStanding, ExtensionWidgetPlacement } from "../../../shared/apiTypes.js";
import type { ExtensionOrigin } from "./extensionOrigin.js";
import { StandingWidgets } from "./standingWidgets.js";

/**
 * What a session's extensions leave standing on its screen through `ctx.ui`: footer statuses,
 * widgets, the working row's words, mark and visibility, the hidden-thinking label and the tab
 * title (extension-ui-counterpart.md, owner 2026-10-04).
 *
 * Statuses are drawn in the status bar between the context and the cost, where there is room
 * (owner, 2026-10-07: PI WEB favours no plugin; what fits is shown, what does not is left out,
 * as in pi's terminal). Widgets are kept with the extension that set them and drawn as that
 * extension's page in Go to, never around the composer (StandingWidgets; extension-keys-in-go-to.md).
 *
 * pi's terminal keeps these in its one process and draws them in its one screen; PI WEB keeps
 * them here, per session runtime, and every browser showing the session draws the snapshot that
 * rides on its status. A status holds one value per key and statuses sort by key, as pi's footer
 * sorts them; a single slot is last-writer-wins, and a reset restores PI WEB's own
 * default even if another extension set the value. A reload of the session's extensions clears
 * everything, as pi's does. Only the payload is bounded, never refused: a text is cut at
 * STATUS_MAX_LENGTH.
 */
export const STATUS_MAX_LENGTH = 1_000;

export class ExtensionStanding {
  private readonly statuses = new Map<string, string>();
  private workingMessage: string | undefined;
  private workingHidden = false;
  private workingFrames: readonly string[] | undefined;
  private hiddenThinkingLabel: string | undefined;
  private title: string | undefined;
  /** The standing values the last broadcast status carried, serialized; see noteSent. */
  private lastSent: string | undefined;

  private readonly widgets: StandingWidgets;
  private readonly header: StandingWidgets;
  private readonly footer: StandingWidgets;

  /** `changed` is told after every write; `theme` is what a widget factory draws with. */
  constructor(private readonly changed: () => void, options: { readonly theme?: unknown; readonly now?: () => number } = {}) {
    const now = options.now ?? (() => Date.now());
    this.widgets = new StandingWidgets(changed, options.theme, now);
    this.header = new StandingWidgets(changed, options.theme, now);
    this.footer = new StandingWidgets(changed, options.theme, now);
  }

  /**
   * pi's `setHeader` and `setFooter` (pi-insertion-points.md slice 5): one header and one footer
   * for the session, the last extension to set one replacing the one before as in pi's terminal,
   * drawn on that extension's Go to page with its widgets (header first, footer last), under the
   * widget rule: clearing one leaves the extension's page saying it shows nothing now. A footer's
   * factory also gets pi's `footerData`.
   */
  setHeader(content: unknown, origin: ExtensionOrigin | undefined): void {
    this.header.set("header", content, "header", origin);
    this.changed();
  }

  setFooter(content: unknown, origin: ExtensionOrigin | undefined, footerData: unknown): void {
    this.footer.set("footer", content, "footer", origin, [footerData]);
    this.changed();
  }

  /** The statuses as pi's `footerData.getExtensionStatuses()` reports them. */
  statusTexts(): ReadonlyMap<string, string> {
    return this.statuses;
  }

  /** pi's `setWidget`, kept with the extension that called it, when it could be told. */
  setWidget(key: string, content: unknown, options: { placement?: unknown } | undefined, origin: ExtensionOrigin | undefined): void {
    const placement: ExtensionWidgetPlacement = options?.placement === "belowEditor" ? "belowEditor" : "aboveEditor";
    this.widgets.set(key, content, placement, origin);
    this.changed();
  }

  /** pi's `setStatus`: a text under its key, or none; a text that is blank once flattened is none. */
  setStatus(key: string, text: unknown): void {
    const flat = text === undefined ? "" : statusText(text);
    if (flat === "") this.statuses.delete(key);
    else this.statuses.set(key, flat);
    this.changed();
  }

  setWorkingMessage(message?: string): void {
    this.workingMessage = message === undefined || message === "" ? undefined : statusText(message);
    this.changed();
  }

  setWorkingVisible(visible: boolean): void {
    this.workingHidden = !visible;
    this.changed();
  }

  setWorkingIndicator(options?: { frames?: string[] }): void {
    this.workingFrames = options?.frames === undefined ? undefined : options.frames.map(statusText);
    this.changed();
  }

  setHiddenThinkingLabel(label?: string): void {
    this.hiddenThinkingLabel = label === undefined || label === "" ? undefined : statusText(label);
    this.changed();
  }

  setTitle(title: string): void {
    this.title = title === "" ? undefined : statusText(title);
    this.changed();
  }

  /** Everything back to PI WEB's defaults: the session's extensions reloaded or its runtime ended. */
  clear(): void {
    this.statuses.clear();
    this.widgets.clear();
    this.header.clear();
    this.footer.clear();
    this.workingMessage = undefined;
    this.workingHidden = false;
    this.workingFrames = undefined;
    this.hiddenThinkingLabel = undefined;
    this.title = undefined;
    this.changed();
  }

  /**
   * What a broadcast status carried, told by the one place that broadcasts it. Every status the
   * browsers receive counts, not only the ones a standing write scheduled: compared with the last
   * scheduled one instead, a value written, broadcast by a turn's status, and written back within
   * one window was never published again, and the browsers kept the middle value (review 64297766).
   * A status read by one page is not a broadcast and is not told.
   */
  noteSent(sent: ExtensionUiStanding | undefined): void {
    this.lastSent = JSON.stringify(sent ?? null);
  }

  /**
   * Whether the values differ from what the last broadcast status carried. An extension that
   * writes the same status or widget again, or a component that redraws the same lines, changes
   * nothing a browser shows, and publishing it anyway sent each open session's whole status to
   * every browser once a second while idle.
   */
  changedSinceSent(): boolean {
    return JSON.stringify(this.snapshot() ?? null) !== this.lastSent;
  }

  /** The wire snapshot, or undefined when nothing stands; a component widget draws now if it is due. */
  snapshot(): ExtensionUiStanding | undefined {
    const widgets = [...this.header.snapshot(), ...this.widgets.snapshot(), ...this.footer.snapshot()];
    const standing: ExtensionUiStanding = {
      ...(widgets.length === 0 ? {} : { widgets }),
      ...(this.statuses.size === 0 ? {} : { statuses: [...this.statuses].sort(([left], [right]) => left.localeCompare(right)).map(([key, text]) => ({ key, text })) }),
      ...(this.workingMessage === undefined ? {} : { workingMessage: this.workingMessage }),
      ...(this.workingHidden ? { workingHidden: true as const } : {}),
      ...(this.workingFrames === undefined ? {} : { workingFrames: [...this.workingFrames] }),
      ...(this.hiddenThinkingLabel === undefined ? {} : { hiddenThinkingLabel: this.hiddenThinkingLabel }),
      ...(this.title === undefined ? {} : { title: this.title }),
    };
    return Object.keys(standing).length === 0 ? undefined : standing;
  }
}

/** pi's footer sanitising (newlines and tabs to spaces, runs of spaces collapsed), then the payload bound. */
function statusText(text: unknown): string {
  const raw = typeof text === "string" ? text : typeof text === "number" || typeof text === "boolean" ? String(text) : "";
  const flat = raw.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
  if (flat.length <= STATUS_MAX_LENGTH) return flat;
  return `${flat.slice(0, STATUS_MAX_LENGTH - 1)}…`;
}
