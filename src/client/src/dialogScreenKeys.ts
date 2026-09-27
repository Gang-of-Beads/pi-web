/**
 * Touch affordances for an extension's TUI screen.
 *
 * A component draws a menu - a cursor line, "Enter to select · ↑↓ to navigate" -
 * and on a desktop that is true: the arrows and Enter are on the keyboard. On a
 * phone there is no keyboard and a `<pre>` raises none, so the screen rendered
 * perfectly and could not be driven at all: the owner's "我根本没法选择…你这是原生
 * 的插件吗".
 *
 * Two ways in, both translating to the keys the component already understands:
 * tapping a line walks the cursor to it and selects, and a key row covers
 * everything else (Esc, and screens whose choice is not a cursor).
 */
const CURSOR_LINE = /^\s*[›>▸▪•*]\s/u;

/** Which line the component's own cursor sits on, if the screen has one. */
export function screenCursorLine(lines: readonly string[]): number | undefined {
  const index = lines.findIndex((line) => CURSOR_LINE.test(line));
  return index === -1 ? undefined : index;
}

/** The keys a tap on `line` should send: walk the cursor there, then Enter. */
export function keysForLineTap(lines: readonly string[], line: number): string[] {
  const cursor = screenCursorLine(lines);
  if (cursor === undefined) return ["enter"];
  if (line === cursor) return ["enter"];
  const step = line > cursor ? "down" : "up";
  return [...Array.from({ length: Math.abs(line - cursor) }, () => step), "enter"];
}

/** Whether the screen is worth letting a tap select on: it has a cursor. */
export function screenIsTappable(lines: readonly string[]): boolean {
  return screenCursorLine(lines) !== undefined;
}

/** A line worth tapping: not blank, and not the component's own hint row. */
export function isSelectableLine(line: string): boolean {
  const text = line.trim();
  if (text === "") return false;
  if (/^(enter|esc|↑|↓|space|tab)/iu.test(text)) return false;
  return true;
}
