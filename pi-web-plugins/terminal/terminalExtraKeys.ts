import { terminalSoftKeySequence, type TerminalModesSnapshot, type TerminalSoftKeyId } from "./terminalKeys.js";

/**
 * The terminal's extra keys, docked above the phone's keyboard as Termux docks
 * its extra-keys row (owner, 2026-10-06: Termux's two rows, with `/` and `-`
 * swapped for ^C and |).
 *
 * The old row was one scrolling line of twenty-one buttons under the tabs:
 * the arrows were off screen until the row was scrolled, and every Ctrl
 * combination was its own button. Termux's answer is two fixed rows of seven
 * with the arrows always in view, and CTRL and ALT as one-shot modifiers that
 * apply to the next key, from this row or from the phone's own keyboard, so
 * any combination is two taps and none needs a button of its own.
 */
export type TerminalModifier = "ctrl" | "alt";

export interface TerminalModifiers {
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export const NO_MODIFIERS: TerminalModifiers = { ctrl: false, alt: false };

type TerminalExtraKeyId = Extract<TerminalSoftKeyId, "escape" | "ctrl-c" | "home" | "arrow-up" | "end" | "page-up" | "tab" | "arrow-left" | "arrow-down" | "arrow-right" | "page-down"> | "pipe";

export type TerminalExtraKey =
  | { readonly kind: "key"; readonly id: TerminalExtraKeyId; readonly label: string; readonly ariaLabel: string; readonly repeats: boolean }
  | { readonly kind: "modifier"; readonly id: TerminalModifier; readonly label: string; readonly ariaLabel: string };

const key = (id: TerminalExtraKeyId, label: string, ariaLabel: string, repeats = false): TerminalExtraKey => ({ kind: "key", id, label, ariaLabel, repeats });
const modifier = (id: TerminalModifier, label: string, ariaLabel: string): TerminalExtraKey => ({ kind: "modifier", id, label, ariaLabel });

/** Two rows of seven, the arrows in the right-hand block of both rows, as Termux lays them out. */
export const TERMINAL_EXTRA_KEY_ROWS: readonly (readonly TerminalExtraKey[])[] = [
  [key("escape", "ESC", "Escape"), key("ctrl-c", "^C", "Control C"), key("pipe", "|", "Pipe"), key("home", "HOME", "Home"), key("arrow-up", "↑", "Up arrow", true), key("end", "END", "End"), key("page-up", "PGUP", "Page up", true)],
  [key("tab", "TAB", "Tab"), modifier("ctrl", "CTRL", "Control, applies to the next key"), modifier("alt", "ALT", "Alt, applies to the next key"), key("arrow-left", "←", "Left arrow", true), key("arrow-down", "↓", "Down arrow", true), key("arrow-right", "→", "Right arrow", true), key("page-down", "PGDN", "Page down", true)],
];

type Sequence = (modes: TerminalModesSnapshot | undefined) => string;
const soft = (id: TerminalSoftKeyId): Sequence => (modes) => terminalSoftKeySequence(id, modes);

const PLAIN: Readonly<Record<TerminalExtraKeyId, Sequence>> = {
  escape: soft("escape"),
  "ctrl-c": soft("ctrl-c"),
  pipe: () => "|",
  home: soft("home"),
  "arrow-up": soft("arrow-up"),
  end: soft("end"),
  "page-up": soft("page-up"),
  tab: soft("tab"),
  "arrow-left": soft("arrow-left"),
  "arrow-down": soft("arrow-down"),
  "arrow-right": soft("arrow-right"),
  "page-down": soft("page-down"),
};

/**
 * Keys xterm encodes with a modifier parameter (`ESC [ 1 ; m X`, `ESC [ n ; m ~`),
 * where m is 1 plus 2 for Alt plus 4 for Ctrl: Ctrl+← is a word left in a shell.
 */
const PARAMETERISED: Partial<Readonly<Record<TerminalExtraKeyId, (parameter: number) => string>>> = {
  "arrow-up": (parameter) => `\x1b[1;${String(parameter)}A`,
  "arrow-down": (parameter) => `\x1b[1;${String(parameter)}B`,
  "arrow-right": (parameter) => `\x1b[1;${String(parameter)}C`,
  "arrow-left": (parameter) => `\x1b[1;${String(parameter)}D`,
  home: (parameter) => `\x1b[1;${String(parameter)}H`,
  end: (parameter) => `\x1b[1;${String(parameter)}F`,
  "page-up": (parameter) => `\x1b[5;${String(parameter)}~`,
  "page-down": (parameter) => `\x1b[6;${String(parameter)}~`,
};

/** What an extra key sends, with the armed modifiers applied. */
export function extraKeySequence(id: TerminalExtraKeyId, modifiers: TerminalModifiers, modes?: TerminalModesSnapshot): string {
  const parameter = 1 + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
  const parameterised = PARAMETERISED[id];
  if (parameterised !== undefined && parameter > 1) return parameterised(parameter);
  return withModifiers(PLAIN[id](modes), modifiers);
}

export interface TypedInput {
  readonly data: string;
  readonly modifiers: TerminalModifiers;
}

const ESC_CODE = 0x1b;

/**
 * Text from the phone's keyboard with the armed modifiers applied, and the
 * modifiers left armed afterwards. Typed text spends them, as a held Ctrl or
 * Alt applies to the key pressed with it. Escape sequences the terminal emits
 * on its own (focus and mouse reports, a hardware key's sequence) pass through
 * and leave them armed, because they are not the key the user meant.
 */
export function typedInput(data: string, modifiers: TerminalModifiers): TypedInput {
  const first = data.codePointAt(0);
  if (first === undefined || first === ESC_CODE || !anyModifier(modifiers)) return { data, modifiers };
  return { data: withModifiers(data, modifiers), modifiers: NO_MODIFIERS };
}

function withModifiers(data: string, modifiers: TerminalModifiers): string {
  const first = data.codePointAt(0);
  if (first === undefined) return data;
  const character = String.fromCodePoint(first);
  const rest = data.slice(character.length);
  return `${modifiers.alt ? "\x1b" : ""}${modifiers.ctrl ? controlCharacter(character) : character}${rest}`;
}

const CONTROL_SPECIALS: ReadonlyMap<string, string> = new Map([[" ", "\x00"], ["?", "\x7f"]]);

/** Ctrl maps `@` through `_` and the letters to 0x00-0x1f as a terminal does; space is NUL and `?` is DEL. */
function controlCharacter(character: string): string {
  const special = CONTROL_SPECIALS.get(character);
  if (special !== undefined) return special;
  const code = character.toUpperCase().charCodeAt(0);
  return code >= 0x40 && code <= 0x5f ? String.fromCharCode(code - 0x40) : character;
}

export function anyModifier(modifiers: TerminalModifiers): boolean {
  return modifiers.ctrl || modifiers.alt;
}

export function toggledModifier(modifiers: TerminalModifiers, which: TerminalModifier): TerminalModifiers {
  return { ...modifiers, [which]: !modifiers[which] };
}
