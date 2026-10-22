import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { keyed } from "lit/directives/keyed.js";
import { formatShortcut } from "../keyboardShortcuts";
import { UNDO_WINDOW_MS, type UndoBarView } from "../controllers/instantActionController";
import { interactiveSurfaceStyles } from "./shared";

/** Why the countdown holds, one per input that can rest on the bar. */
const PAUSES: Readonly<Record<"pointer" | "press" | "focus", string>> = { pointer: "pointer", press: "press", focus: "focus" };

/**
 * The Undo bar (owner, 2026-10-21: the bar at the bottom of the column that acted). One line on
 * the panel surface with a hairline above: what was done on the left, Undo on the right, and a
 * 2 px countdown line along its top edge. The countdown holds while a finger, the pointer or
 * focus rests on the bar; the owner of the window (`InstantActionController`) keeps the time, and
 * the line only draws it.
 *
 * Focus never moves to the bar: a following Enter must not be an accidental Undo.
 *
 * A press that starts on the bar holds the countdown until it ends wherever it ends: released or
 * cancelled anywhere, the window losing focus, or the pointer leaving the window. A mouse has no
 * implicit capture, so the bar alone never hears a release made off it, and the window would stay
 * paused with a held removal never sent.
 *
 * The polite live region is always mounted, and empty while there is no bar, so what the bar says
 * is announced when it appears; a region inserted together with its words is not read by every
 * screen reader.
 */
@customElement("undo-bar")
export class UndoBar extends LitElement {
  @property({ attribute: false }) view: UndoBarView | undefined;
  @property({ attribute: false }) onUndo?: (actionId: number) => void;
  @property({ attribute: false }) onPause?: (reason: string) => void;
  @property({ attribute: false }) onResume?: (reason: string) => void;
  private press: AbortController | undefined;

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.releasePress();
  }

  private holdPress(): void {
    this.press?.abort();
    const press = new AbortController();
    this.press = press;
    const release = () => { this.releasePress(); };
    for (const type of ["pointerup", "pointercancel", "blur"]) window.addEventListener(type, release, { signal: press.signal });
    window.addEventListener("pointerout", (event: PointerEvent) => { if (event.relatedTarget === null) release(); }, { signal: press.signal });
    this.onPause?.(PAUSES.press);
  }

  private releasePress(): void {
    if (this.press === undefined) return;
    this.press.abort();
    this.press = undefined;
    this.onResume?.(PAUSES.press);
  }

  override render() {
    const view = this.view;
    return html`
      <span class="announce" role="status" aria-live="polite">${view === undefined ? "" : `${view.words.verb} ${view.words.subject}`}</span>
      ${view === undefined ? nothing : this.renderBar(view)}
    `;
  }

  private renderBar(view: UndoBarView) {
    const { words } = view;
    const fuse = `animation-duration: ${String(UNDO_WINDOW_MS)}ms; animation-delay: -${String(Math.round(view.elapsedMs))}ms; animation-play-state: ${view.paused ? "paused" : "running"};`;
    return html`
      <div
        class="bar"
        @pointerenter=${(event: PointerEvent) => { if (event.pointerType === "mouse") this.onPause?.(PAUSES.pointer); }}
        @pointerleave=${() => { this.onResume?.(PAUSES.pointer); }}
        @pointerdown=${() => { this.holdPress(); }}
        @focusin=${() => { this.onPause?.(PAUSES.focus); }}
        @focusout=${() => { this.onResume?.(PAUSES.focus); }}
      >
        ${keyed(view.actionId, html`<span class="fuse" style=${fuse} aria-hidden="true"></span>`)}
        <p class="words" title=${`${words.verb} ${words.subject}`}><span class=${words.danger ? "verb danger" : "verb"}>${words.verb}</span> ${words.subject}</p>
        <button type="button" class="undo" aria-label=${`Undo ${words.undoName}`} @click=${() => { this.onUndo?.(view.actionId); }}>Undo</button>
        <span class="shortcut" aria-hidden="true">${formatShortcut("mod+z")}</span>
      </div>
    `;
  }

  static override styles = [interactiveSurfaceStyles, css`
    :host { display: block; flex: 0 0 auto; }
    .announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .bar { pointer-events: auto; position: relative; box-sizing: border-box; display: flex; align-items: center; gap: var(--pi-space-4); min-height: calc(var(--pi-control-height-comfort) + 2 * var(--pi-space-4)); padding: var(--pi-space-4) var(--pi-chat-gutter, var(--pi-space-5)); border-top: 1px solid var(--pi-border); background: var(--pi-surface-panel, var(--pi-surface)); color: var(--pi-text); font: var(--pi-text-sm) var(--pi-font-ui); }
    .fuse { position: absolute; top: -1px; left: 0; right: 0; height: 2px; background: var(--pi-accent); transform-origin: left center; animation-name: undo-fuse; animation-timing-function: linear; animation-fill-mode: forwards; }
    @keyframes undo-fuse { from { transform: scaleX(1); } to { transform: scaleX(0); } }
    @media (prefers-reduced-motion: reduce) { .fuse { animation-name: none; } }
    /* A provider's warning (Remove workspace) must be read, not cut to one line: up to four lines, then the title holds the rest. */
    .words { flex: 1 1 auto; min-width: 0; margin: 0; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; overflow-wrap: anywhere; line-height: 1.35; }
    .verb { font-weight: var(--pi-weight-semibold); }
    .verb.danger { color: var(--pi-danger); }
    .undo { position: relative; flex: 0 0 auto; box-sizing: border-box; min-height: var(--pi-control-height-comfort); padding: 0 var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface-raised, var(--pi-surface)); color: var(--pi-text-bright, var(--pi-text)); font: inherit; cursor: pointer; }
    .undo:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset-inset); }
    @media (hover: hover) { .undo:hover { border-color: var(--pi-accent); } }
    @media (pointer: coarse) { .undo::after { content: ""; position: absolute; inset: calc((var(--pi-control-height-comfort) - var(--pi-control-height-touch)) / 2 - 1px) 0; } }
    .shortcut { display: none; flex: 0 0 auto; color: var(--pi-muted); font: var(--pi-text-2xs) var(--pi-font-mono, monospace); }
    @media (hover: hover) and (pointer: fine) { .shortcut { display: inline; } }
  `];
}

declare global {
  interface HTMLElementTagNameMap {
    "undo-bar": UndoBar;
  }
}
