import { describe, expect, it } from "vitest";
import { AppContextBar } from "./appShell/AppContextBar";
import { AppNavigatePage } from "./appShell/AppNavigatePage";
import { StatusBar } from "./StatusBar";
import { PromptEditor } from "./PromptEditor";

describe("control chrome text selection (T1/T3)", () => {
  it("navigation page chrome is not a copy target", () => {
    expect(String(AppNavigatePage.styles)).toContain("user-select: none");
  });

  it("context bar chrome is not a copy target", () => {
    expect(String(AppContextBar.styles)).toContain("user-select: none");
  });

  it("status bar chrome is not a copy target", () => {
    expect(String(StatusBar.styles)).toContain("user-select: none");
  });

  it("composer chrome disables selection but keeps its text controls selectable", () => {
    const styles = String(PromptEditor.styles);
    expect(styles).toContain("user-select: none");
    expect(styles).toMatch(/\[contenteditable\][^{]*\{[^}]*user-select: text/s);
    expect(styles).toMatch(/attachment-error[^{]*\{[^}]*user-select: text/s);
  });
});
