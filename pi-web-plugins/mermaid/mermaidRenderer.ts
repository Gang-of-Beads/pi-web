/**
 * Renders one mermaid fence as an inline SVG, or refuses so the host keeps
 * the plain code block.
 *
 * The library is loaded on the first diagram, never at boot: a 5MB graph
 * of chunked diagram engines has no business in the page until a transcript
 * shows a fence. Rendering is strict (`securityLevel: "strict"` sanitizes
 * the SVG and forbids click handlers), and the source is parsed before it is
 * drawn so a syntax error throws a readable message instead of leaving a
 * half-drawn diagram in the DOM. Every draw gets a unique id because mermaid
 * keys its work on it and a repeated id draws over the previous render.
 */

export interface MermaidLike {
  initialize(config: { startOnLoad: boolean; securityLevel: "strict"; theme: "dark" | "default" }): void;
  parse(source: string): Promise<unknown>;
  render(id: string, source: string): Promise<{ svg: string }>;
}

export interface MermaidRendererDependencies {
  loadMermaid: () => Promise<MermaidLike>;
  darkTheme: () => boolean;
  createElement: (tag: string) => HTMLElement;
}

export function createMermaidFenceRenderer(dependencies: MermaidRendererDependencies): (source: string) => Promise<Node> {
  let loading: Promise<MermaidLike> | undefined;
  let configuredDark: boolean | undefined;
  let sequence = 0;

  async function engine(): Promise<MermaidLike> {
    loading ??= dependencies.loadMermaid().catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    const mermaid = await loading;
    const dark = dependencies.darkTheme();
    if (configuredDark !== dark) {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: dark ? "dark" : "default" });
      configuredDark = dark;
    }
    return mermaid;
  }

  return async (source: string): Promise<Node> => {
    const trimmed = source.trim();
    if (trimmed === "") throw new Error("Empty mermaid fence");
    const mermaid = await engine();
    await mermaid.parse(trimmed);
    sequence += 1;
    const { svg } = await mermaid.render(`pi-web-mermaid-${String(sequence)}`, trimmed);
    const figure = dependencies.createElement("figure");
    figure.className = "pi-web-mermaid";
    figure.style.margin = "0";
    figure.style.overflowX = "auto";
    figure.innerHTML = svg;
    if (figure.querySelector("svg") === null) throw new Error("Mermaid produced no SVG");
    return figure;
  };
}

/** The theme the diagram should match: the page's background, not the OS. */
export function pageIsDark(root: { getPropertyValue(name: string): string } | undefined, fallback: boolean): boolean {
  const value = root?.getPropertyValue("--pi-bg").trim() ?? "";
  const rgb = /^#([0-9a-f]{6})$/iu.exec(value);
  if (rgb?.[1] === undefined) return fallback;
  const hex = rgb[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) < 128;
}
