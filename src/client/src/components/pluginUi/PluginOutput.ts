import { css, html, LitElement, nothing, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";
import { interactiveSurfaceStyles } from "../shared";
import { bottomAnchorAction } from "../../bottomAnchor";
import { BOX_WORDS } from "../pluginList/pluginListView";
import { outputViewState, withoutTerminalEscapes } from "./outputView";
import type { PluginOutputView } from "../../../../shared/pluginApiTypes";

const EMPTY_OUTPUT: PluginOutputView = { label: "", read: "reading", text: "", words: { empty: "", reading: "", failed: "", stale: "" } };

/**
 * A plugin's output, a monospace view with its own scroll. It is held at the bottom as text grows,
 * by the transcript's own rule (`bottomAnchorAction`), until the reader scrolls up; scrolling back
 * to the bottom holds it again. The scroll is not contained: a finger at the view's end carries on
 * into the page, so a view inside a list never traps it. The region is not live: a plugin that
 * polls every few seconds would flood a screen reader.
 */
export class PluginOutputElement extends LitElement {
  @property({ attribute: false }) output: PluginOutputView = EMPTY_OUTPUT;

  private pinnedToBottom = true;
  private userScrolling = false;
  private heightBeforeUpdate: number | undefined;

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: flex; flex-direction: column; min-width: 0; min-height: 0; gap: var(--pi-space-2); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); line-height: 1.4; }
    :host([size="fill"]) { flex: 1 1 auto; height: 100%; }
    .line { margin: 0; color: var(--pi-dim); font-size: var(--pi-text-xs); overflow-wrap: anywhere; }
    .line.stale { color: var(--pi-warning); }
    pre { --pi-output-line: 1.4em; box-sizing: border-box; margin: 0; min-width: 0; max-height: calc(12 * var(--pi-output-line) + 2 * var(--pi-space-4)); overflow-y: auto; padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); background: var(--pi-surface-canvas); color: var(--pi-text); font: var(--pi-text-xs) var(--pi-font-mono); line-height: var(--pi-output-line); white-space: pre-wrap; overflow-wrap: anywhere; }
    :host([size="fill"]) pre { flex: 1 1 auto; max-height: none; }
    pre:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-tight); }
    .box { box-sizing: border-box; margin: 0; padding: var(--pi-space-6); border: 1px dashed var(--pi-border); border-radius: var(--pi-radius-md); color: var(--pi-muted); text-align: center; }
  `];

  protected override willUpdate(): void {
    this.setAttribute("size", this.output.size ?? "tail");
    this.heightBeforeUpdate = this.view()?.scrollHeight;
  }

  override render() {
    const output = this.output;
    const state = outputViewState(output.read, output.text);
    if (state === "box") return html`<p class="box" role="status">${BOX_WORDS[output.read](output.words)}</p>`;
    return html`
      ${state === "text-stale" ? html`<p class="line stale" role="status">${output.words.stale}</p>` : nothing}
      ${output.cutAbove === undefined || output.cutAbove === "" ? nothing : html`<p class="line">${output.cutAbove}</p>`}
      <pre role="log" aria-live="off" aria-label=${output.label} tabindex="0"
        @scroll=${this.onScroll}
        @touchstart=${this.onTouchStart}
        @touchend=${this.onTouchEnd}
        @touchcancel=${this.onTouchEnd}
      >${withoutTerminalEscapes(output.text)}</pre>
    `;
  }

  protected override updated(): void {
    const view = this.view();
    if (view === undefined) return;
    const action = bottomAnchorAction({
      pinnedToBottom: this.pinnedToBottom,
      userScrolling: this.userScrolling,
      previousHeight: this.heightBeforeUpdate ?? 0,
      currentHeight: view.scrollHeight,
    });
    if (action === "hold-bottom") view.scrollTop = view.scrollHeight;
  }

  private view(): HTMLPreElement | undefined {
    return this.renderRoot.querySelector("pre") ?? undefined;
  }

  private readonly onScroll = (): void => {
    const view = this.view();
    if (view === undefined) return;
    const oneLine = Number.parseFloat(getComputedStyle(view).lineHeight);
    this.pinnedToBottom = view.scrollHeight - view.scrollTop - view.clientHeight <= (Number.isNaN(oneLine) ? 0 : oneLine);
  };

  private readonly onTouchStart = (): void => { this.userScrolling = true; };
  private readonly onTouchEnd = (): void => { this.userScrolling = false; };
}

if (customElements.get("pi-web-plugin-output") === undefined) customElements.define("pi-web-plugin-output", PluginOutputElement);

export function renderPluginOutput(output: PluginOutputView): TemplateResult {
  return html`<pi-web-plugin-output .output=${output}></pi-web-plugin-output>`;
}
