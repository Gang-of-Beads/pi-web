import type { ExtensionEditorTextMode } from "../../../shared/apiTypes.js";

/**
 * An extension's `setEditorText` / `pasteToEditor` for one session runtime, and what its
 * `getEditorText` answers (docs/design/extension-ui-counterpart.md, Composer).
 *
 * Every browser showing the session writes its composer from the published frame. pi's
 * `getEditorText` is synchronous and the daemon cannot read a browser's draft, so it answers with
 * what the runtime's extensions wrote, a paste joining the end; pi's RPC host answers `""` for want
 * of one. The text lives as long as the runtime: like pi's composer it outlives a reload of the
 * extensions, and a replaced runtime (tree navigation, a fork) starts empty. A value that is not
 * text writes nothing: pi's types say string, and the composer would show "[object Object]".
 *
 * A message or command sent from a composer empties it, as pi's editor empties itself before it
 * runs what was submitted (pi-tui `Editor.submitValue`). Kept until then, the text read as the
 * reader's input: pi-prompt-history took the last prompt it had loaded as its query and listed
 * one result (owner, 2026-10-11).
 */
export class ExtensionComposer {
  private written = "";

  constructor(private readonly publish: (mode: ExtensionEditorTextMode, text: string) => void) {}

  write(mode: ExtensionEditorTextMode, text: unknown): void {
    if (typeof text !== "string") return;
    this.written = mode === "set" ? text : `${this.written}${text}`;
    this.publish(mode, text);
  }

  text(): string {
    return this.written;
  }

  /** The reader sent what a composer held; each browser empties its own composer on a send. */
  submitted(): void {
    this.written = "";
  }
}
