import type { ExtensionWidgetPlacement, ExtensionWidgetStanding } from "../../../shared/apiTypes.js";
import { customScreenHarness, isScreenComponent, renderCustomScreen, type CustomScreenComponent } from "./customScreen.js";
import type { ExtensionOrigin } from "./extensionOrigin.js";

/**
 * The widgets a session's extensions set with pi's `ctx.ui.setWidget`, each with the extension
 * that set it (extension-keys-in-go-to.md). Nothing here is drawn around the composer: every
 * extension's widgets are its own page in Go to (owner, 2026-10-07), so a widget keeps who wrote
 * it. A cleared widget stays as an empty one: the extension's key stays in Go to and its page says
 * it shows nothing now, until the session's extensions reload. Clearing a key that held nothing
 * leaves nothing: an extension that only ever clears (pi-background-tasks does, at every turn) has
 * drawn nothing and brings no key. A component that could not be built still keeps its author's key,
 * so the extension's page exists and says it shows nothing, instead of the widget vanishing.
 *
 * Only the payload is bounded, never refused: a widget is cut at WIDGET_MAX_LINES lines of
 * LINE_MAX_LENGTH characters, saying what it cut.
 */
export const WIDGET_MAX_LINES = 100;
export const LINE_MAX_LENGTH = 1_000;
/** How old a component widget's drawing may grow before the next snapshot draws it again. */
export const WIDGET_REDRAW_MS = 1_000;

/**
 * One widget. Lines are kept as given. A component is drawn when it asks (`tui.requestRender()`)
 * or when its drawing is WIDGET_REDRAW_MS old, and only as a snapshot is built: drawing it on every
 * status put extension code on the daemon's per-chunk path (pi-goal's widget reads a file per
 * render), and a request made while it draws is ignored, so a render that asks again cannot loop.
 */
class StandingWidget {
  private stale = true;
  private drawing = false;
  private disposed = false;
  private drawnAt = 0;

  private constructor(
    readonly placement: ExtensionWidgetPlacement,
    readonly origin: ExtensionOrigin | undefined,
    private readonly component: CustomScreenComponent | undefined,
    private lines: readonly string[],
  ) {}

  static ofLines(placement: ExtensionWidgetPlacement, origin: ExtensionOrigin | undefined, lines: readonly string[]): StandingWidget {
    return new StandingWidget(placement, origin, undefined, boundedLines(lines));
  }

  static ofComponent(placement: ExtensionWidgetPlacement, origin: ExtensionOrigin | undefined, component: CustomScreenComponent): StandingWidget {
    return new StandingWidget(placement, origin, component, []);
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

export class StandingWidgets {
  private readonly widgets = new Map<string, StandingWidget>();

  /** `changed` is told when a component asks to be drawn again; `theme` is what a factory draws with. */
  constructor(private readonly changed: () => void, private readonly theme: unknown, private readonly now: () => number) {}

  /** One keyed block for pi's `setWidget`, `setHeader` or `setFooter`: lines or a component factory under `key`, or none; a factory gets `factoryArgs` after the theme. */
  set(key: string, content: unknown, placement: ExtensionWidgetPlacement, origin: ExtensionOrigin | undefined, factoryArgs: readonly unknown[] = []): void {
    const previous = this.widgets.get(key);
    previous?.dispose();
    const widget = this.widgetFrom(content, placement, origin, factoryArgs);
    if (widget !== undefined) {
      this.widgets.set(key, widget);
      return;
    }
    const author = previous?.origin ?? origin;
    const triedToDraw = typeof content === "function";
    if (author === undefined || (previous === undefined && !triedToDraw)) this.widgets.delete(key);
    else this.widgets.set(key, StandingWidget.ofLines(placement, author, []));
  }

  clear(): void {
    for (const widget of this.widgets.values()) widget.dispose();
    this.widgets.clear();
  }

  /** The wire entries, a component widget drawn now if it is due. */
  snapshot(): ExtensionWidgetStanding[] {
    const now = this.now();
    return [...this.widgets].map(([key, widget]) => ({
      key,
      placement: widget.placement,
      lines: [...widget.currentLines(now)],
      ...(widget.origin === undefined ? {} : { extension: { id: widget.origin.id, title: widget.origin.title, ...(widget.origin.surface === undefined ? {} : { surface: widget.origin.surface }) } }),
    }));
  }

  private widgetFrom(content: unknown, placement: ExtensionWidgetPlacement, origin: ExtensionOrigin | undefined, factoryArgs: readonly unknown[]): StandingWidget | undefined {
    if (Array.isArray(content)) return StandingWidget.ofLines(placement, origin, content.map((line: unknown) => (typeof line === "string" ? line : String(line))));
    if (typeof content !== "function") return undefined;
    let widget: StandingWidget | undefined;
    const harness = customScreenHarness({ requestRender: () => { if (widget?.invalidate() === true) this.changed(); } });
    try {
      const component: unknown = Reflect.apply(content, undefined, [harness.tui, this.theme, ...factoryArgs]);
      if (!isScreenComponent(component)) return undefined;
      widget = StandingWidget.ofComponent(placement, origin, component);
      return widget;
    } catch (error) {
      console.warn("An extension widget could not be built and is not shown", error);
      return undefined;
    }
  }
}

/** Each line cut at LINE_MAX_LENGTH with its indentation kept, then the count cut, saying how much. */
export function boundedLines(lines: readonly string[]): string[] {
  const cut = lines.map((line) => (line.length <= LINE_MAX_LENGTH ? line : `${line.slice(0, LINE_MAX_LENGTH - 1)}…`));
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
