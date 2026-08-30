import { describe, expect, it } from "vitest";
import { composerCollapseTransition } from "./composerCollapse";

/**
 * The owner's two-tap report (2026-08-31, third sighting): tapping a dialog
 * button collapsed the composer mid-tap, the dialog moved ~90px between
 * pointerdown and pointerup, and the tap landed nowhere. The collapse must
 * wait for the pointer to come up.
 */
describe("composerCollapseTransition", () => {
  it("holds the next value while the pointer is down", () => {
    const next = composerCollapseTransition({ pointerInFlight: true, collapsed: false, held: undefined, next: true });
    expect(next.collapsed).toBe(false);
    expect(next.held).toBe(true);
  });

  it("applies the held value on release", () => {
    const next = composerCollapseTransition({ pointerInFlight: false, collapsed: false, held: true, next: false });
    expect(next.collapsed).toBe(true);
    expect(next.held).toBeUndefined();
  });

  it("collapses immediately when no pointer is in flight", () => {
    const next = composerCollapseTransition({ pointerInFlight: false, collapsed: false, held: undefined, next: true });
    expect(next.collapsed).toBe(true);
    expect(next.held).toBeUndefined();
  });

  it("a release with nothing held keeps the current state", () => {
    const next = composerCollapseTransition({ pointerInFlight: false, collapsed: false, held: undefined, next: false });
    expect(next.collapsed).toBe(false);
    expect(next.held).toBeUndefined();
  });
});
