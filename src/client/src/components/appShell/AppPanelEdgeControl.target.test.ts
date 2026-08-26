// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { AppPanelEdgeControl } from "./AppPanelEdgeControl";

/**
 * The control that collapses a side panel is a sliver pinned to the panel's
 * edge: 18px wide, which is narrower than the 24px minimum target size in
 * WCAG 2.2 AA, and it had no hit area beyond its own box.
 *
 * The width is deliberate - a fat handle would sit on top of the panel it
 * belongs to - so the fix is to give the control a hit area larger than its
 * paint, not to make it look bigger.
 */
const RENDERED_WIDTH = 14;

describe("the panel edge control", () => {
  it("takes a hit area at least as wide as the minimum target size", () => {
    const rule = ruleFor(".edge-button::after");

    expect(rule, "expected an ::after hit area on .edge-button").not.toBe("");
    // The declared width is 18px but the flex host shrinks it to 14px, which
    // is what a pointer actually has to hit. Measuring against the declared
    // number would pass while the real control stayed under target size.
    const inset = /inset:\s*0\s*(-?\d+)px/u.exec(rule)?.[1];
    expect(inset, "expected a horizontal inset expressing the hit area").toBeDefined();
    expect(RENDERED_WIDTH + 2 * Math.abs(Number(inset))).toBeGreaterThanOrEqual(24);
  });

  it("keeps the hit area from covering the panel it sits against", () => {
    const rule = ruleFor(".edge-button::after");
    const inset = Math.abs(Number(/inset:\s*0\s*(-?\d+)px/u.exec(rule)?.[1] ?? "0"));

    // A handle that reaches far into the panel steals clicks from the rows
    // behind it, which is the bug the toggle already caused once in the
    // session list.
    expect(inset).toBeLessThanOrEqual(8);
  });
});

function ruleFor(selector: string): string {
  const sheet = String(AppPanelEdgeControl.styles);
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(sheet)?.[1] ?? "";
}
