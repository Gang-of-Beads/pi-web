import type { AppAction } from "./actions";
import { normalizeShortcut } from "./keyboardShortcuts";
import type { ExtensionShortcutInfo } from "../../shared/apiTypes";

/**
 * A session's pi extension shortcuts as actions (docs/design/pi-insertion-points.md, slice 4).
 *
 * Each is an action in the Actions palette under "Extensions", run on the daemon. Its key is bound
 * through PI WEB's own shortcut engine, unless PI WEB already uses it, as pi keeps its reserved keys:
 * then the action stays in the palette without that key, and Settings can give it another. A pi key
 * PI WEB cannot bind is left unbound too: one without Ctrl, Cmd or Alt, which typing would trigger,
 * and one with Ctrl or Cmd alone, which is the browser's (reload, close, new tab, find, save and the
 * like): a terminal hands pi's `ctrl+r` to pi, a browser keeps it.
 */
export function extensionShortcutActions(
  shortcuts: readonly ExtensionShortcutInfo[],
  takenKeys: readonly string[],
  run: (key: string) => void | Promise<void>,
): AppAction[] {
  const taken = takenKeys.map((shortcut) => normalizeShortcut(shortcut).join(" ")).filter((key) => key !== "");
  return shortcuts.map((shortcut) => {
    const bound = webShortcut(shortcut.key);
    const free = bound !== undefined && !taken.some((key) => clashes(key, bound));
    return {
      id: `extension-shortcut:${shortcut.key}`,
      title: shortcut.description ?? `Extension shortcut ${shortcut.key}`,
      description: `From ${shortcut.extension} (pi key ${shortcut.key})`,
      group: "Extensions",
      ...(free ? { shortcut: bound } : {}),
      run: () => run(shortcut.key),
    };
  });
}

/**
 * pi's key id in PI WEB's notation (`super` is the Cmd/Ctrl key PI WEB calls `mod`), when PI WEB
 * may bind it: its first chord carries Alt, or Ctrl/Cmd with another modifier. Undefined otherwise.
 */
function webShortcut(piKey: string): string | undefined {
  const tokens = normalizeShortcut(piKey.split("+").map((part) => (part === "super" ? "mod" : part)).join("+"));
  const first = tokens[0];
  if (first === undefined) return undefined;
  const modifiers = first.split("+").slice(0, -1);
  const bindable = modifiers.includes("alt") || (modifiers.includes("mod") && modifiers.length >= 2);
  return bindable ? tokens.join(" ") : undefined;
}

/** Whether two key sequences collide: the same, or one the start of the other. */
function clashes(left: string, right: string): boolean {
  return left === right || left.startsWith(`${right} `) || right.startsWith(`${left} `);
}
