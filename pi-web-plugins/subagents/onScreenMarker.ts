/**
 * Whether the subagents panel is on screen, told by the page rather than by
 * the host's renders.
 *
 * The host keeps the active workspace panel rendered while the phone shows
 * the chat, hidden by the shell's layout, and re-renders it on every app
 * update. A render is therefore not a look, and a poll kept alive by renders
 * would run on in the chat (measured on 8505: one read at each settle with the
 * panel hidden). This marker sits at the top of the panel's own template and
 * reports, through an IntersectionObserver, whether that part of the page is
 * shown. A hidden ancestor leaves it without a box, which reads as not shown.
 * Where the page cannot observe, nothing is reported, and the panel counts as
 * shown: one read too many, never one too few.
 */
export const ON_SCREEN_MARKER_TAG = "pi-subagents-on-screen";

export interface OnScreenMarker extends HTMLElement {
  onChange: ((shown: boolean) => void) | undefined;
}

let sharedObserver: IntersectionObserver | undefined;

export function defineOnScreenMarker(): void {
  if (typeof customElements === "undefined" || typeof HTMLElement === "undefined" || customElements.get(ON_SCREEN_MARKER_TAG) !== undefined) return;
  class SubagentsOnScreenMarker extends HTMLElement implements OnScreenMarker {
    onChange: ((shown: boolean) => void) | undefined;

    connectedCallback(): void {
      this.style.display = "block";
      if (typeof IntersectionObserver === "undefined") return;
      sharedObserver ??= new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target instanceof SubagentsOnScreenMarker) entry.target.onChange?.(entry.isIntersecting);
        }
      });
      sharedObserver.observe(this);
    }

    disconnectedCallback(): void {
      sharedObserver?.unobserve(this);
      this.onChange?.(false);
    }
  }
  customElements.define(ON_SCREEN_MARKER_TAG, SubagentsOnScreenMarker);
}
