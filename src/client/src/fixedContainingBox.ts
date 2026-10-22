/**
 * Where a `position: fixed` element rendered beside a given node is placed.
 *
 * The app shell contains its layout (PiWebApp), so a fixed element inside it
 * is placed against the shell, and the shell follows the visible viewport.
 * Client coordinates and `innerWidth` describe the browser's layout viewport
 * instead, and the two part: Chrome on Android can leave the layout viewport
 * wider than the screen after Back (owner, 2026-10-22: the phone page turned
 * desktop-wide and could be dragged sideways). A probe placed the way the
 * element will be placed answers where it lands without naming the ancestor
 * that contains it. Without layout - no document, or a probe with no size - the
 * answer is the window.
 */
export interface FixedBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export function fixedContainingBox(near: unknown): FixedBox {
  const windowBox: FixedBox = { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
  if (typeof document === "undefined" || typeof Node === "undefined" || !(near instanceof Node)) return windowBox;
  const root = near.getRootNode();
  const parent = typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root : document.body;
  const probe = document.createElement("div");
  probe.style.cssText = "all: initial; position: fixed; inset: 0; visibility: hidden; pointer-events: none;";
  parent.append(probe);
  try {
    const rect = probe.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : windowBox;
  } finally {
    probe.remove();
  }
}
