import { describe, expect, it } from "vitest";
import { formattedTextStyles } from "./shared";

/**
 * Owner report from the phone: the code block's copy control drew an empty
 * square. The mark carries the shared icon class, but this shadow root does
 * not adopt the shared icon sheet, so nothing sized it.
 */
describe("the code copy control's mark", () => {
  it("is sized by the stylesheet that owns the control", () => {
    const css = String(formattedTextStyles);
    expect(css).toMatch(/\.code-copy-button (\.ui-icon, \.code-copy-button )?svg \{[^}]*width: 14px/u);
    expect(css).toMatch(/\.code-copy-button[^{]*svg \{[^}]*height: 14px/u);
  });
});
