// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CommandPicker } from "./CommandPicker";
import { ModelPicker } from "./ModelPicker";

/**
 * The layer tokens rank kinds of surface: a popover (30) sits below a dialog
 * (50). That ranking inverts the moment a picker is opened from inside a
 * dialog — settings opens the theme or model picker, the picker takes focus and
 * Escape because it registered last, and CSS paints it underneath the settings
 * panel. What the user sees is a backdrop dimming, no picker, an Escape that
 * looks dead, and a settings dialog that no longer takes clicks.
 *
 * A picker opened over a dialog is a child of it, so it says so and paints
 * above it; opened on its own it keeps the popover layer.
 */
describe("a picker opened from a dialog", () => {
  it("declares a layer above the dialog when it is asked to", () => {
    for (const styles of [String(ModelPicker.styles), String(CommandPicker.styles)]) {
      expect(styles).toContain(":host([abovedialog]) { z-index: calc(var(--pi-layer-dialog) + 1); }");
      expect(styles).toContain("z-index: var(--pi-layer-popover)");
    }
  });

  it("is told to whenever the settings dialog is on screen", () => {
    const shell = readFileSync("src/client/src/components/PiWebApp.ts", "utf8");
    const openings = [...shell.matchAll(/<(command-picker|model-picker)([^>]*)/gu)];

    expect(openings.length).toBeGreaterThan(0);
    for (const [, element, attributes] of openings) {
      expect(attributes, `${element ?? "picker"} must state its layer`).toContain("?abovedialog=${this.settingsOpen}");
    }
  });
});
