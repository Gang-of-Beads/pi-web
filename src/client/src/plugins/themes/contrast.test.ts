import { describe, expect, it } from "vitest";
import { html, svg } from "lit";
import type { PluginId } from "../types.js";
import { themePackPlugin } from "./index.js";

/**
 * Every theme's text must be readable on the surface it is drawn on.
 *
 * A palette is chosen once and then lived with, so the floor belongs in a test
 * rather than in a note about how it was picked. WCAG AA for body text is
 * 4.5:1; these check each theme's text ramp against both its page background
 * and its raised surface, since a card sits on one and the page on the other.
 *
 * Only the clay pair is policed here. Running the same check across the themes
 * that predate it fails in fourteen places - pi-web-dark's accent, pi-web-light's
 * success and warning, and the dimmest text of four themes - and changing
 * colours somebody chose is a product decision, not a test fix. That result is
 * recorded for the owner rather than acted on.
 */

const POLICED_THEME_IDS = new Set(["clay-soft", "clay-paper"]);

const AA_BODY = 4.5;

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const high = Math.max(first, second);
  const low = Math.min(first, second);
  return (high + 0.05) / (low + 0.05);
}

/** Opaque six-digit values only: the overlays carry alpha and are not text. */
function isOpaqueHex(value: string): boolean {
  return /^#[0-9a-f]{6}$/iu.test(value);
}

const TEXT_TOKENS = ["--pi-text", "--pi-text-secondary", "--pi-muted", "--pi-dim", "--pi-accent", "--pi-success", "--pi-warning", "--pi-danger", "--pi-purple"] as const;

const pluginId: PluginId = "pi-web-themes";
const themes = themePackPlugin.activate({
  apiVersion: 2,
  pluginId,
  runtimePluginId: pluginId,
  html,
  svg,
}).contributions.themes ?? [];

describe("theme text contrast", () => {
  it("ships the themes this file is meant to police", () => {
    expect(themes.filter((theme) => POLICED_THEME_IDS.has(theme.id))).toHaveLength(POLICED_THEME_IDS.size);
  });

  for (const theme of themes) {
    if (!POLICED_THEME_IDS.has(theme.id)) continue;
    const tokens: Record<string, string> = { ...theme.tokens };
    const background = tokens["--pi-bg"] ?? "";
    const surface = tokens["--pi-surface"] ?? "";

    for (const token of TEXT_TOKENS) {
      const colour = tokens[token];
      if (colour === undefined || !isOpaqueHex(colour) || !isOpaqueHex(background)) continue;

      it(`${theme.id}: ${token} is readable on the page`, () => {
        expect(contrast(colour, background)).toBeGreaterThanOrEqual(AA_BODY);
      });

      if (isOpaqueHex(surface)) {
        it(`${theme.id}: ${token} is readable on a surface`, () => {
          expect(contrast(colour, surface)).toBeGreaterThanOrEqual(AA_BODY);
        });
      }
    }
  }
});
