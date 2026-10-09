import type { ExtensionShortcutInfo } from "../../../shared/apiTypes.js";

/**
 * pi's `registerShortcut` in PI WEB (docs/design/pi-insertion-points.md, slice 4).
 *
 * pi binds each extension shortcut in its editor and lists it under "Extensions" in its hotkeys
 * help; a browser has no terminal editor, so the session's status names them and the page offers
 * each as an action, run here with the context pi gives an extension. `getShortcuts` is pi's own
 * resolution: a key a reserved built-in owns is skipped, and of two extensions the later wins.
 */
export interface ExtensionShortcutRunner {
  getShortcuts(resolvedKeybindings: Record<string, unknown>): ReadonlyMap<string, { readonly description?: string | undefined; readonly extensionPath: string; handler(context: unknown): unknown }>;
  createContext(): unknown;
}

const NO_CUSTOM_KEYBINDINGS: Record<string, unknown> = {};

/**
 * The session's shortcuts, read once per runner: pi resolves them again on every call, reporting
 * each conflict as it goes, and the status is built on every event. A reload brings a new runner.
 */
export class ExtensionShortcuts {
  private readonly listed = new WeakMap<ExtensionShortcutRunner, readonly ExtensionShortcutInfo[]>();

  list(runner: ExtensionShortcutRunner, titleOf: (extensionPath: string) => string | undefined): readonly ExtensionShortcutInfo[] {
    const known = this.listed.get(runner);
    if (known !== undefined) return known;
    const shortcuts = [...runner.getShortcuts(NO_CUSTOM_KEYBINDINGS)].map(([key, shortcut]) => ({
      key,
      extension: titleOf(shortcut.extensionPath) ?? fileName(shortcut.extensionPath),
      ...(shortcut.description === undefined || shortcut.description === "" ? {} : { description: shortcut.description }),
    }));
    this.listed.set(runner, shortcuts);
    return shortcuts;
  }

  /**
   * Start a shortcut's handler as pi's editor does, without waiting for it: a handler may open a
   * dialog and wait for the reader. Undefined when the session has no shortcut on that key. A
   * failure reaches `onError`, as pi shows "Shortcut handler error".
   */
  run(runner: ExtensionShortcutRunner, key: string, onError: (message: string) => void): "started" | undefined {
    const shortcut = runner.getShortcuts(NO_CUSTOM_KEYBINDINGS).get(key);
    if (shortcut === undefined) return undefined;
    void Promise.resolve()
      .then(() => shortcut.handler(runner.createContext()))
      .catch((error: unknown) => { onError(`Shortcut handler error: ${error instanceof Error ? error.message : String(error)}`); });
    return "started";
  }
}

/** An extension no longer listed as loaded is named by its file. */
function fileName(extensionPath: string): string {
  const file = extensionPath.split(/[\\/]/u).filter((part) => part !== "").at(-1) ?? extensionPath;
  return file.replace(/\.[cm]?[jt]s$/u, "") || extensionPath;
}
