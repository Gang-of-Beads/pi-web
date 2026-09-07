import { describe, expect, it } from "vitest";
import { chatStyles } from "./ChatView";

const sheet = String(chatStyles);

/**
 * A media query adds no specificity, so a coarse-pointer override loses to any
 * same-specificity rule that sets the same property later in the sheet. This
 * shipped as a live bug once: the coarse .drawer-collapse 44px rule sat above
 * a later base 32px re-declaration and the touch target measured 32x32 on
 * phones (the same incident is on record in shared.ts). The guard asserts the
 * ordering rule the drawer's comment promises: after the coarse block, no base
 * rule for the same selectors may set the properties the block raises.
 */
describe("the drawer cascade order", () => {
  const drawerCoarseStart = sheet.indexOf(".drawer-collapse { width: var(--pi-control-height-touch)");
  const coarseBlockStart = drawerCoarseStart === -1 ? -1 : sheet.lastIndexOf("@media (pointer: coarse)", drawerCoarseStart);
  let coarseBlockEnd = coarseBlockStart;
  if (coarseBlockStart !== -1) {
    let depth = 0;
    for (let i = sheet.indexOf("{", coarseBlockStart); i < sheet.length; i += 1) {
      if (sheet[i] === "{") depth += 1;
      if (sheet[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          coarseBlockEnd = i + 1;
          break;
        }
      }
    }
  }
  const after = coarseBlockEnd === -1 ? "" : sheet.slice(coarseBlockEnd);

  const rulesAfter = (selector: string): string[] => {
    const re = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "gu");
    return [...after.matchAll(re)].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
  };

  it("keeps the coarse drawer overrides ahead of any same-property base rule", () => {
    expect(coarseBlockStart).toBeGreaterThan(-1);
    for (const body of rulesAfter("\\.drawer-collapse")) {
      expect(body).not.toMatch(/(^|[^-])width:/u);
      expect(body).not.toMatch(/(^|[^-])height:/u);
    }
    for (const body of rulesAfter("\\.drawer-tab")) {
      expect(body).not.toMatch(/min-height:/u);
    }
  });

  it("sizes the coarse drawer targets from the touch token", () => {
    const coarse = sheet.slice(coarseBlockStart, sheet.indexOf("}", drawerCoarseStart));
    expect(coarse).toMatch(/\.drawer-tab \{ min-height: var\(--pi-control-height-touch\)/u);
    expect(coarse).toMatch(/\.drawer-collapse \{ width: var\(--pi-control-height-touch\); height: var\(--pi-control-height-touch\)/u);
  });
});
