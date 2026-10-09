import { CUSTOM_SCREEN_WIDTH, isScreenComponent, renderCustomScreen } from "./customScreen.js";
import { plainTextTheme } from "./plainTextTheme.js";
import { boundedLines } from "./standingWidgets.js";

/**
 * A custom message or a custom entry drawn by the extension that wrote it, as pi's terminal draws
 * it (docs/design/pi-insertion-points.md, slice 1).
 *
 * pi lets an extension register a renderer for its custom messages and for its custom session
 * entries; the terminal draws each with the extension's component, falls back to the message's
 * content, and shows an entry only when an extension registered a renderer for it. PI WEB showed
 * neither: an unclaimed custom message read "Nothing on this machine renders", and every custom
 * entry was dropped, so an extension's custom entries never appeared (owner, 2026-10-09:
 * PI WEB's insertion points are a superset of pi's). The session's own extension runner holds
 * the renderers, so this runs where the session runs, and the component is drawn to lines the way
 * custom screens and widgets are. A session without a runtime has no runner, so it draws nothing.
 */
export interface ExtensionRenderers {
  getMessageRenderer(customType: string): unknown;
  getEntryRenderer(customType: string): unknown;
}

export type CustomRowKind = "message" | "entry";

/** A pi message or entry renderer: the item, the render options, the theme; a component or nothing. */
type CustomRowRenderer = (value: unknown, options: { expanded: boolean; outputPad: number }, theme: unknown) => unknown;

function isRenderer(value: unknown): value is CustomRowRenderer {
  return typeof value === "function";
}

/**
 * What differs between the two kinds of row, as pi's terminal treats them: where the renderer is
 * registered, and what a renderer that throws leaves. A message falls back to its content; an
 * entry has no content, so it shows pi's own failure line.
 */
const ROW_KINDS: Readonly<Record<CustomRowKind, {
  readonly rendererOf: (renderers: ExtensionRenderers, customType: string) => unknown;
  readonly whenRendererFails: (customType: string, error: unknown) => string[] | undefined;
}>> = {
  message: { rendererOf: (renderers, customType) => renderers.getMessageRenderer(customType), whenRendererFails: () => undefined },
  entry: {
    rendererOf: (renderers, customType) => renderers.getEntryRenderer(customType),
    whenRendererFails: (customType, error) => [`[${customType}] renderer failed: ${error instanceof Error ? error.message : String(error)}`],
  },
};

/** Whether the session shows a custom entry of this type at all: pi shows one only with a renderer. */
export function showsCustomEntry(renderers: ExtensionRenderers, customType: string): boolean {
  return isRenderer(renderers.getEntryRenderer(customType));
}

/**
 * The lines the extension's renderer draws for one custom message or entry, collapsed as pi's
 * terminal first shows them, and bounded as a widget is. Undefined: no renderer, or it drew
 * nothing, so the row falls back to pi's default. A renderer that throws leaves what its kind
 * leaves (`ROW_KINDS`).
 */
export function drawCustomRow(renderers: ExtensionRenderers, kind: CustomRowKind, customType: string, value: unknown): string[] | undefined {
  const renderer = ROW_KINDS[kind].rendererOf(renderers, customType);
  if (!isRenderer(renderer)) return undefined;
  try {
    const component: unknown = renderer(value, { expanded: false, outputPad: 1 }, plainTextTheme);
    if (!isScreenComponent(component)) return undefined;
    const lines = boundedLines(renderCustomScreen(component, CUSTOM_SCREEN_WIDTH, Number.POSITIVE_INFINITY));
    return lines.length === 0 ? undefined : lines;
  } catch (error) {
    return ROW_KINDS[kind].whenRendererFails(customType, error);
  }
}
