/**
 * What pi's terminal hands a component for a key the browser names.
 *
 * A TUI component reads raw terminal input: pi-tui's `matchesKey(data, "up")` holds for
 * "\x1b[A", never for the word "up", and Enter is "\r". The browser forwards keys by name, and
 * the screen used to hand those names straight to `handleInput`, so a real component (a pi-tui
 * list, pi-prompt-history's picker) read Enter as typed text and never moved. Each name now
 * becomes the bytes a terminal sends for it; a name with no terminal form is dropped, unreported,
 * instead of being typed. Text arrives one character per key, the way pi's stdin buffer splits
 * typing.
 */
const NAMED_KEYS: Readonly<Record<string, string>> = {
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  enter: "\r",
  escape: "\x1b",
  tab: "\t",
  backspace: "\x7f",
  space: " ",
};

const CONTROL_LETTER = /^ctrl\+([a-z])$/u;
const ONE_CHARACTER = /^[\s\S]$/u;

/** The terminal input for a named key or one typed character, or undefined when a terminal has none. */
export function terminalKeyData(key: string): string | undefined {
  const named = NAMED_KEYS[key];
  if (named !== undefined) return named;
  const letter = CONTROL_LETTER.exec(key)?.[1];
  if (letter !== undefined) return String.fromCharCode(letter.charCodeAt(0) - 96);
  return ONE_CHARACTER.test(key) ? key : undefined;
}
