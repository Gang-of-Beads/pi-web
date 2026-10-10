import { plainTextTheme } from "./plainTextTheme.js";

/**
 * pi's components (`BorderedLoader`, `DynamicBorder`, key hints) read a global theme that only
 * pi's terminal host initializes, so an extension screen built from them threw
 * "Theme not initialized" in this daemon before drawing anything (an extension's install screen,
 * 8505, 2026-10-04). pi keeps that theme under `Symbol.for` keys precisely so every copy of its
 * package shares it, an extension's own bundled copy included; setting the plain-text theme there
 * once makes those components render as plain lines, like the theme extensions already receive
 * through `ctx.ui.theme`.
 */
const PI_GLOBAL_THEME_KEYS = [
  Symbol.for("@earendil-works/pi-coding-agent:theme"),
  Symbol.for("@mariozechner/pi-coding-agent:theme"),
] as const;

export function installPlainGlobalTheme(): void {
  for (const key of PI_GLOBAL_THEME_KEYS) Reflect.set(globalThis, key, plainTextTheme);
}
