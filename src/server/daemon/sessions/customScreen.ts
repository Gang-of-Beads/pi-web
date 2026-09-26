/**
 * A TUI component rendered for a browser.
 *
 * `ctx.ui.custom(factory)` hands an extension a terminal component; pi's headless
 * host resolved the promise without ever running the factory, so an extension
 * that meant to show a screen saw an immediate cancel - the pi updater asked for
 * its version prompt every session and got nothing, which is the notice the owner
 * photographed.
 *
 * The browser cannot run a TUI, but a component is only two things: lines for a
 * width, and keys in. Both are transportable. What it needs from the terminal is
 * a `tui` and a `keybindings` object; the theme is already the daemon's plain one
 * (`plainTextTheme`), which is why the lines need no ANSI stripping.
 */
import { EXTENSION_DIALOG_SCREEN_MAX_LINES } from "../../../shared/apiTypes.js";

/** The little of a TUI component this host drives. */
export interface CustomScreenComponent {
  render(width: number): string[];
  handleInput?(key: string): void;
  dispose?(): void;
}

/** The width a screen is rendered for: a phone modal, minus its padding. */
export const CUSTOM_SCREEN_WIDTH = 56;

/**
 * What the component gets when it asks the terminal questions.
 *
 * Any method call answers with its own last argument (`theme.fg("accent", text)`
 * style calls) and any property read that is not a method answers `undefined`
 * rather than throwing, so a component that pokes the terminal does not crash the
 * session over a detail nobody renders.
 */
export function customScreenHarness(): { tui: object; keybindings: object } {
  const make = (): object => {
    const members: Record<string, unknown> = {};
    return new Proxy(members, {
      get: (target, property): unknown => {
        if (property === "then") return undefined;
        const key = String(property);
        if (target[key] === undefined) target[key] = (...args: unknown[]) => (args.length === 0 ? undefined : args[args.length - 1]);
        return target[key];
      },
      has: () => true,
    });
  };
  return { tui: make(), keybindings: make() };
}

/** Render, bounded and free of a trailing blank tail. */
export function renderCustomScreen(component: CustomScreenComponent, width = CUSTOM_SCREEN_WIDTH, maxLines: number = EXTENSION_DIALOG_SCREEN_MAX_LINES): string[] {
  const lines = component.render(width);
  const trimmed = [...lines];
  while (trimmed.length > 0 && (trimmed[trimmed.length - 1] ?? "").trim() === "") trimmed.pop();
  return trimmed.slice(0, maxLines);
}
