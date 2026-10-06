---
"@gang-of-beads/pi-web": patch
---

Pi extensions can now use `ctx.ui.editor()`, which opens a card with a multi-line text box holding the extension's text; Send returns the edited text and Cancel nothing, and Enter behaves as it does in the composer. `setEditorText` and `pasteToEditor` now write the session's composer in every browser showing it, and `getEditorText` returns what the session's extensions wrote. Restart the session daemon, then reload the browser.
