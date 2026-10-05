import type { ExtensionUiStanding, ExtensionWidgetPlacement } from "../../../shared/apiTypes.js";
import { customScreenHarness, renderCustomScreen, type CustomScreenComponent } from "./customScreen.js";

/**
 * What a session's extensions leave standing on its screen through `ctx.ui`: footer statuses,
 * widgets, the working row's words, mark and visibility, the hidden-thinking label and the tab
 * title (extension-ui-counterpart.md, owner 2026-10-04).
 *
 * pi's terminal keeps these in its one process and draws them in its one screen; PI WEB keeps
 * them here, per session runtime, and every browser showing the session draws the snapshot that
 * rides on its status. The rules are pi's: a keyed slot (status, widget) holds one value per key
 * and statuses sort by key as pi's footer sorts them; a single slot is last-writer-wins, and a
 * reset restores PI WEB's own default even if another extension set the value. A reload of the
 * session's extensions clears everything, as pi's does.
 *
 * Only the payload is bounded, never refused: a status is cut at STATUS_MAX_LENGTH, and a widget
 * at WIDGET_MAX_LINES lines of STATUS_MAX_LENGTH characters, each saying what it cut. How much of
 * it fits on screen is the browser's.
 */
export const STATUS_MAX_LENGTH = 1_000;
export const WIDGET_MAX_LINES = 100;
/** How old a component widget's drawing may grow before the next status draws it again. */
export const WIDGET_REDRAW_MS = 1_000;

/**
 * One widget. Lines are kept as given. A component is drawn when it asks (`tui.requestRender()`)
 * or when its drawing is WIDGET_REDRAW_MS old, and only as a status is built: drawing it on every
 * status put extension code on the daemon's per-chunk path (pi-goal's widget reads a file per
 * render), and a request made while it draws is ignored, so a render that asks again cannot loop.
 */
class StandingWidget {
  private stale = true;
  private drawing = false;
  private disposed = false;
  private drawnAt = 0;

  private constructor(readonly placement: ExtensionWidgetPlacement, private readonly component: CustomScreenComponent | undefined, private lines: readonly string[]) {}

  static ofLines(placement: ExtensionWidgetPlacement, lines: readonly string[]): StandingWidget {
    return new StandingWidget(placement, undefined, boundedLines(lines));
  }

  static ofComponent(placement: ExtensionWidgetPlacement, component: CustomScreenComponent): StandingWidget {
    return new StandingWidget(placement, component, []);
  }

  /** A redraw request; false when it changes nothing (lines, drawing now, or disposed). */
  invalidate(): boolean {
    if (this.component === undefined || this.drawing || this.disposed) return false;
    this.stale = true;
    return true;
  }

  currentLines(now: number): readonly string[] {
    if (this.component === undefined || (!this.stale && now - this.drawnAt < WIDGET_REDRAW_MS)) return this.lines;
    this.drawing = true;
    try {
      this.lines = boundedLines(drawn(this.component));
    } finally {
      this.drawing = false;
    }
    this.stale = false;
    this.drawnAt = now;
    return this.lines;
  }

  dispose(): void {
    this.disposed = true;
    try {
      this.component?.dispose?.();
    } catch (error) {
      console.warn("An extension widget failed to dispose", error);
    }
  }
}

export class ExtensionStanding {
  private readonly statuses = new Map<string, string>();
  private readonly widgets = new Map<string, StandingWidget>();
  private workingMessage: string | undefined;
  private workingHidden = false;
  private workingFrames: readonly string[] | undefined;
  private hiddenThinkingLabel: string | undefined;
  private title: string | undefined;

  /** `changed` is told after every write; `theme` is what a widget factory draws with. */
  constructor(private readonly changed: () => void, private readonly theme: unknown, private readonly now: () => number = () => Date.now()) {}

  setStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.statuses.delete(key);
    else this.statuses.set(key, statusText(text));
    this.changed();
  }

  setWidget(key: string, content: unknown, options?: { placement?: ExtensionWidgetPlacement }): void {
    this.widgets.get(key)?.dispose();
    const widget = this.widgetFrom(content, options?.placement === "belowEditor" ? "belowEditor" : "aboveEditor");
    if (widget === undefined) this.widgets.delete(key);
    else this.widgets.set(key, widget);
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
    for (const widget of this.widgets.values()) widget.dispose();
    this.statuses.clear();
    this.widgets.clear();
    this.workingMessage = undefined;
    this.workingHidden = false;
    this.workingFrames = undefined;
    this.hiddenThinkingLabel = undefined;
    this.title = undefined;
    this.changed();
  }

  /** The wire snapshot, or undefined when nothing stands; a component widget draws now if it is due. */
  snapshot(): ExtensionUiStanding | undefined {
    const now = this.now();
    const standing: ExtensionUiStanding = {
      ...(this.statuses.size === 0 ? {} : { statuses: [...this.statuses].sort(([left], [right]) => left.localeCompare(right)).map(([key, text]) => ({ key, text })) }),
      ...(this.widgets.size === 0 ? {} : { widgets: [...this.widgets].map(([key, widget]) => ({ key, placement: widget.placement, lines: [...widget.currentLines(now)] })) }),
      ...(this.workingMessage === undefined ? {} : { workingMessage: this.workingMessage }),
      ...(this.workingHidden ? { workingHidden: true as const } : {}),
      ...(this.workingFrames === undefined ? {} : { workingFrames: [...this.workingFrames] }),
      ...(this.hiddenThinkingLabel === undefined ? {} : { hiddenThinkingLabel: this.hiddenThinkingLabel }),
      ...(this.title === undefined ? {} : { title: this.title }),
    };
    return Object.keys(standing).length === 0 ? undefined : standing;
  }

  private widgetFrom(content: unknown, placement: ExtensionWidgetPlacement): StandingWidget | undefined {
    if (Array.isArray(content)) return StandingWidget.ofLines(placement, content.map((line) => (typeof line === "string" ? line : String(line))));
    if (typeof content !== "function") return undefined;
    let widget: StandingWidget | undefined;
    const harness = customScreenHarness({ requestRender: () => { if (widget?.invalidate() === true) this.changed(); } });
    try {
      const component: unknown = Reflect.apply(content, undefined, [harness.tui, this.theme]);
      if (!isComponent(component)) return undefined;
      widget = StandingWidget.ofComponent(placement, component);
      return widget;
    } catch (error) {
      console.warn("An extension widget could not be built and is not shown", error);
      return undefined;
    }
  }
}

function isComponent(value: unknown): value is CustomScreenComponent {
  return typeof value === "object" && value !== null && "render" in value && typeof value.render === "function";
}

/** pi's footer sanitising (newlines and tabs to spaces, runs of spaces collapsed), then the payload bound. */
function statusText(text: unknown): string {
  const raw = typeof text === "string" ? text : typeof text === "number" || typeof text === "boolean" ? String(text) : "";
  const flat = raw.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
  if (flat.length <= STATUS_MAX_LENGTH) return flat;
  return `${flat.slice(0, STATUS_MAX_LENGTH - 1)}…`;
}

/** Each line cut at STATUS_MAX_LENGTH with its indentation kept, then the count cut, saying how much. */
function boundedLines(lines: readonly string[]): string[] {
  const cut = lines.map((line) => (line.length <= STATUS_MAX_LENGTH ? line : `${line.slice(0, STATUS_MAX_LENGTH - 1)}…`));
  if (cut.length <= WIDGET_MAX_LINES) return cut;
  return [...cut.slice(0, WIDGET_MAX_LINES - 1), `… ${String(cut.length - WIDGET_MAX_LINES + 1)} more lines not shown`];
}

/** The whole drawing, so the cut can say how much it cut. */
function drawn(component: CustomScreenComponent): string[] {
  try {
    return renderCustomScreen(component, undefined, Number.POSITIVE_INFINITY);
  } catch (error) {
    console.warn("An extension widget failed to render", error);
    return [];
  }
}
