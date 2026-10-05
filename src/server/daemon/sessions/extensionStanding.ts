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
 * Only the payload is bounded, never refused: a status is cut at STATUS_MAX_LENGTH and a widget
 * at WIDGET_MAX_LINES, each saying what it cut. How much of it fits on screen is the browser's.
 */
export const STATUS_MAX_LENGTH = 1_000;
export const WIDGET_MAX_LINES = 100;

type WidgetSource = { readonly kind: "lines"; readonly lines: readonly string[] } | { readonly kind: "component"; readonly component: CustomScreenComponent };

interface StandingWidget {
  readonly placement: ExtensionWidgetPlacement;
  readonly source: WidgetSource;
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
  constructor(private readonly changed: () => void, private readonly theme: unknown) {}

  setStatus(key: string, text: string | undefined): void {
    if (text === undefined) this.statuses.delete(key);
    else this.statuses.set(key, statusText(text));
    this.changed();
  }

  setWidget(key: string, content: unknown, options?: { placement?: ExtensionWidgetPlacement }): void {
    this.disposeWidget(key);
    const source = this.widgetSource(content);
    if (source === undefined) this.widgets.delete(key);
    else this.widgets.set(key, { placement: options?.placement === "belowEditor" ? "belowEditor" : "aboveEditor", source });
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
    for (const key of this.widgets.keys()) this.disposeWidget(key);
    this.statuses.clear();
    this.widgets.clear();
    this.workingMessage = undefined;
    this.workingHidden = false;
    this.workingFrames = undefined;
    this.hiddenThinkingLabel = undefined;
    this.title = undefined;
    this.changed();
  }

  /** The wire snapshot, or undefined when nothing stands; a widget component draws now. */
  snapshot(): ExtensionUiStanding | undefined {
    const standing: ExtensionUiStanding = {
      ...(this.statuses.size === 0 ? {} : { statuses: [...this.statuses].sort(([left], [right]) => left.localeCompare(right)).map(([key, text]) => ({ key, text })) }),
      ...(this.widgets.size === 0 ? {} : { widgets: [...this.widgets].map(([key, widget]) => ({ key, placement: widget.placement, lines: widgetLines(widget.source) })) }),
      ...(this.workingMessage === undefined ? {} : { workingMessage: this.workingMessage }),
      ...(this.workingHidden ? { workingHidden: true as const } : {}),
      ...(this.workingFrames === undefined ? {} : { workingFrames: [...this.workingFrames] }),
      ...(this.hiddenThinkingLabel === undefined ? {} : { hiddenThinkingLabel: this.hiddenThinkingLabel }),
      ...(this.title === undefined ? {} : { title: this.title }),
    };
    return Object.keys(standing).length === 0 ? undefined : standing;
  }

  private widgetSource(content: unknown): WidgetSource | undefined {
    if (Array.isArray(content)) return { kind: "lines", lines: content.map((line) => (typeof line === "string" ? line : String(line))) };
    if (typeof content !== "function") return undefined;
    try {
      const harness = customScreenHarness({ requestRender: this.changed });
      const component: unknown = Reflect.apply(content, undefined, [harness.tui, this.theme]);
      return isComponent(component) ? { kind: "component", component } : undefined;
    } catch (error) {
      console.warn("An extension widget could not be built and is not shown", error);
      return undefined;
    }
  }

  private disposeWidget(key: string): void {
    const source = this.widgets.get(key)?.source;
    if (source?.kind !== "component") return;
    try {
      source.component.dispose?.();
    } catch (error) {
      console.warn("An extension widget failed to dispose", error);
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

function widgetLines(source: WidgetSource): string[] {
  const lines = source.kind === "lines" ? source.lines : drawn(source.component);
  if (lines.length <= WIDGET_MAX_LINES) return [...lines];
  return [...lines.slice(0, WIDGET_MAX_LINES - 1), `… ${String(lines.length - WIDGET_MAX_LINES + 1)} more lines not shown`];
}

function drawn(component: CustomScreenComponent): string[] {
  try {
    return renderCustomScreen(component, undefined, WIDGET_MAX_LINES + 1);
  } catch (error) {
    console.warn("An extension widget failed to render", error);
    return [];
  }
}
