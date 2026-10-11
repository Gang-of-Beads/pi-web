/**
 * A keypress, by the name the session daemon reads.
 *
 * The browser forwards what it hears as a name ("up", "enter", "escape", a
 * letter) through this one mapping, and the daemon turns each name into the
 * bytes pi's terminal would hand the component, so the component keeps working
 * without knowing it is no longer attached to a terminal.
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
