import { describe, expect, it } from "vitest";
import { DEFAULT_THEME_PREFERENCE, findThemePairForTheme, resolveThemePreference } from "./theme";
import type { QualifiedContributionId, QualifiedThemeContribution, QualifiedThemePairContribution, ThemeColorScheme } from "./plugins/types";
import { CORE_MATERIAL_DARK_TOKENS } from "./nativeDarkTheme";

const tokens = CORE_MATERIAL_DARK_TOKENS;

const themes = [
  theme("pi-web-dark", "PI WEB Dark", "dark"),
  theme("pi-web-light", "PI WEB Light", "light"),
  theme("classic", "PI WEB Classic", "dark"),
  theme("clay-soft", "Clay", "dark"),
  theme("clay-paper", "Clay Paper", "light"),
];

const themePairs: QualifiedThemePairContribution[] = [
  {
    id: "themes:pi-web",
    pluginId: "themes",
    localId: "pi-web",
    name: "PI WEB",
    light: "themes:pi-web-light",
    dark: "themes:pi-web-dark",
  },
  {
    id: "themes:clay",
    pluginId: "themes",
    localId: "clay",
    name: "Clay",
    light: "themes:clay-paper",
    dark: "themes:clay-soft",
  },
];

describe("resolveThemePreference", () => {
  it("resolves the default preference to the native pro look, whatever the system says", () => {
    const resolution = resolveThemePreference({ themes, themePairs, preference: DEFAULT_THEME_PREFERENCE, prefersLight: false });
    expect(resolution.selectedTheme).toBeUndefined();
    expect(resolution.activeTheme).toBeUndefined();
  });

  it("still pairs a chosen soft theme when auto is on", () => {
    const dark = resolveThemePreference({ themes, themePairs, preference: { themeId: "themes:clay-soft", auto: true }, prefersLight: false });
    expect(dark.activeTheme?.id).toBe("themes:clay-soft");
    const light = resolveThemePreference({ themes, themePairs, preference: { themeId: "themes:clay-soft", auto: true }, prefersLight: true });
    expect(light.activeTheme?.id).toBe("themes:clay-paper");
  });

  it("keeps an unpaired theme selected when auto is enabled", () => {
    const resolution = resolveThemePreference({
      themes,
      themePairs,
      preference: { themeId: "themes:classic", auto: true },
      prefersLight: true,
    });

    expect(resolution.selectedTheme?.id).toBe("themes:classic");
    expect(resolution.activeTheme?.id).toBe("themes:classic");
    expect(resolution.selectedThemePair).toBeUndefined();
  });

  it("shows the core's own look when the selected theme does not exist", () => {
    const resolution = resolveThemePreference({
      themes,
      themePairs,
      preference: { themeId: "plugin:missing", auto: false },
      prefersLight: true,
    });

    expect(resolution.selectedTheme).toBeUndefined();
    expect(resolution.activeTheme).toBeUndefined();
  });

  it("shows the core's own look without mutating a missing selected theme preference", () => {
    const preference = {
      themeId: "plugin:missing",
      auto: true,
    } satisfies { themeId: QualifiedContributionId; auto: boolean };
    const resolution = resolveThemePreference({
      themes,
      themePairs,
      preference,
      prefersLight: false,
    });

    expect(resolution.selectedTheme).toBeUndefined();
    expect(resolution.activeTheme).toBeUndefined();
    expect(preference).toEqual({ themeId: "plugin:missing", auto: true });
  });

  it("can look up a pair from either member theme", () => {
    expect(findThemePairForTheme(themePairs, "themes:pi-web-light")?.id).toBe("themes:pi-web");
    expect(findThemePairForTheme(themePairs, "themes:pi-web-dark")?.id).toBe("themes:pi-web");
  });
});

function theme(localId: string, name: string, colorScheme: ThemeColorScheme): QualifiedThemeContribution {
  return {
    id: `themes:${localId}`,
    pluginId: "themes",
    localId,
    name,
    colorScheme,
    tokens,
  };
}
