import { html, svg } from "lit";
import { describe, expect, it } from "vitest";
import themePackPlugin from "./pi-web-plugin.js";

const contributions = themePackPlugin.activate({
  apiVersion: 2,
  pluginId: "themes",
  runtimePluginId: "themes",
  html,
  svg,
}).contributions;

describe("the bundled theme pack", () => {
  it("contributes the themes the app ships with, in order", () => {
    expect((contributions.themes ?? []).map((theme) => ({ id: theme.id, colorScheme: theme.colorScheme }))).toEqual([
      { id: "pi-web-dark", colorScheme: "dark" },
      { id: "pi-web-light", colorScheme: "light" },
      { id: "classic", colorScheme: "dark" },
      { id: "high-contrast", colorScheme: "dark" },
      { id: "night", colorScheme: "dark" },
      { id: "paper", colorScheme: "light" },
      { id: "clay-soft", colorScheme: "dark" },
      { id: "clay-paper", colorScheme: "light" },
    ]);
  });

  it("pairs the light and dark halves that follow the system preference", () => {
    expect((contributions.themePairs ?? []).map((pair) => ({ id: pair.id, light: pair.light, dark: pair.dark }))).toEqual([
      { id: "pi-web", light: "pi-web-light", dark: "pi-web-dark" },
      { id: "clay", light: "clay-paper", dark: "clay-soft" },
    ]);
  });
});
