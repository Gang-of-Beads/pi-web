// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PromptEditor } from "./PromptEditor";
import { saveDraft } from "../promptDraftStorage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return Array.from(this.values.keys())[index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

/**
 * The compacting/shell hint used to float over the editor (absolute, bottom
 * right) and covered text the user was typing. It is now an in-flow row
 * rendered before the editor: the hint and the text box must not occupy the
 * same rectangle.
 */
beforeEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: new MemoryStorage(), configurable: true });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true });
});

describe("PromptEditor mode hint placement", () => {
  function editorWithHint(kind: "compact" | "shell"): PromptEditor {
    // Shell mode comes from the stored draft ("!"), the same path a real
    // session takes: willUpdate reloads the draft from storage on append.
    // Storage is installed in beforeEach, so saveDraft lands before append.
    if (kind === "shell") saveDraft("local:session-hint", "!echo hi");
    const editor = new PromptEditor();
    editor.sessionId = "session-hint";
    editor.isCompacting = kind === "compact";
    return editor;
  }

  for (const kind of ["compact", "shell"] as const) {
    it(`${kind} hint is a sibling rendered before the editor`, async () => {
      const editor = editorWithHint(kind);
      document.body.append(editor);
      await editor.updateComplete;
      await editor.updateComplete;
      const hint = editor.shadowRoot?.querySelector(".mode-hint");
      const textBox = editor.shadowRoot?.querySelector(".markdown-editor");
      expect(hint).not.toBeNull();
      expect(textBox).not.toBeNull();
      if (hint === null || hint === undefined || textBox === null || textBox === undefined) return;
      // Sibling order: hint first, editor second — never stacked on top.
      expect(hint.compareDocumentPosition(textBox) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(textBox.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
      editor.remove();
      localStorage.clear();
    });
  }
});