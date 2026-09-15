import type { PiWebPlugin } from "@gang-of-beads/pi-web/plugin-api";
import { createMermaidFenceRenderer, pageIsDark, type MermaidLike } from "./mermaidRenderer.js";

/**
 * The library ships beside this module as a vendored, chunked ESM bundle
 * (see piWeb.vendorBundles in package.json), resolved against this file so
 * the same plugin works under any application prefix. The URL is built at
 * call time, not bundled, so the bundler leaves the graph lazy.
 */
function loadMermaid(): Promise<MermaidLike> {
  const url = new URL("./vendor/mermaid/mermaid.core.js", import.meta.url).href;
  return import(/* @vite-ignore */ url).then((module: { default: MermaidLike }) => module.default);
}

const render = createMermaidFenceRenderer({
  loadMermaid,
  darkTheme: () => pageIsDark(getComputedStyle(document.documentElement), matchMedia("(prefers-color-scheme: dark)").matches),
  createElement: (tag) => document.createElement(tag),
});

const plugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Mermaid Diagrams",
  activate: () => ({
    contributions: {
      codeFenceRenderers: [{ id: "mermaid", language: "mermaid", render }],
    },
  }),
};

export default plugin;
