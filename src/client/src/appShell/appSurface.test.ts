import { describe, expect, it } from "vitest";
import { APP_FEATURE_SPECS, featureSlot, isShellLayout, shellFeatureIds, type ShellLayout } from "./appSurface";

const LAYOUTS: readonly ShellLayout[] = ["desktopExpanded", "desktopCollapsed", "mobile"];

describe("appSurface feature table", () => {
  it("gives every feature a slot on every layout", () => {
    for (const spec of APP_FEATURE_SPECS) {
      for (const layout of LAYOUTS) {
        expect(featureSlot(spec.id, layout), `${spec.id} on ${layout}`).toBeDefined();
      }
    }
  });

  it("never hides a feature on all layouts", () => {
    for (const spec of APP_FEATURE_SPECS) {
      const visible = LAYOUTS.filter((layout) => featureSlot(spec.id, layout) !== "hidden");
      expect(visible.length, `${spec.id} must be reachable somewhere`).toBeGreaterThan(0);
    }
  });

  it("keeps the resident bar to the approved minimal set", () => {
    const barFeatures = APP_FEATURE_SPECS.filter((spec) => LAYOUTS.some((layout) => spec.slots[layout] === "bar"));
    expect(barFeatures.map((spec) => spec.id)).toEqual(["panelToggle", "sessionSwitch", "workingIndicator"]);
  });

  it("keeps every feature reachable on mobile through the panel or the bar", () => {
    for (const spec of APP_FEATURE_SPECS) {
      expect(["bar", "panel"], `${spec.id} mobile slot`).toContain(spec.slots.mobile);
    }
  });

  it("exposes ids in a stable order for the contract test", () => {
    expect(shellFeatureIds()).toMatchSnapshot();
  });

  it("rejects unknown layouts", () => {
    expect(isShellLayout("mobile")).toBe(true);
    expect(isShellLayout("watch")).toBe(false);
  });
});
