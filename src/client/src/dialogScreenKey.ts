/**
 * A keypress, named the way a TUI component expects it.
 *
 * `ctx.ui.custom` hands the extension's component raw keys, and pi's terminal
 * names them ("up", "enter", "escape", a letter). The browser modal forwards what
 * it hears through this one mapping, so the component keeps working without
 * knowing it is no longer attached to a terminal.
 */
const NAMED: Readonly<Record<string, string>> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  Enter: "enter",
  Escape: "escape",
  " ": "space",
  Backspace: "backspace",
  Tab: "tab",
};

/** The key id for an event, or undefined for a modifier-only press. */
export function dialogScreenKey(event: { key: string; ctrlKey?: boolean | undefined; metaKey?: boolean | undefined }): string | undefined {
  if (event.key === "Shift" || event.key === "Control" || event.key === "Alt" || event.key === "Meta") return undefined;
  const named = NAMED[event.key];
  if (named !== undefined) return named;
  if (event.ctrlKey === true || event.metaKey === true) return `ctrl+${event.key.toLowerCase()}`;
  if (event.key.length === 1) return event.key;
  return undefined;
}
