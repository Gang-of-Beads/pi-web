// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { QualifiedContributionId, QualifiedThemeContribution, ThemeTokens } from "../../plugins/types";
import { PluginRegistry } from "../../plugins/registry";
import { themePackPlugin } from "../../plugins/themes";
import { SettingsAppearancePanel } from "./SettingsAppearancePanel";

afterEach(() => {
  document.body.replaceChildren();
});

/**
 * Real contributed themes as the fixture base, through the registry that the
 * app itself uses: the token sets are complete by construction and stay
 * complete when a token is added.
 */
function contributedThemes(): QualifiedThemeContribution[] {
  const registry = new PluginRegistry();
  registry.register({ id: "themes", plugin: themePackPlugin });
  return [...registry.getThemes()];
}

function tokens(overrides: Partial<ThemeTokens> = {}): ThemeTokens {
  const base = contributedThemes()[0];
  if (base === undefined) throw new Error("Expected the theme pack to contribute a theme");
  return { ...base.tokens, ...overrides };
}

function themeId(id: string): QualifiedContributionId {
  return `themes:${id}`;
}

function theme(id: string, overrides: Partial<QualifiedThemeContribution> = {}): QualifiedThemeContribution {
  return {
    id: themeId(id),
    pluginId: "themes",
    localId: id,
    name: id,
    order: 10,
    colorScheme: "dark",
    tokens: tokens(),
    ...overrides,
  };
}

async function mount(configure: (panel: SettingsAppearancePanel) => void = () => undefined): Promise<SettingsAppearancePanel> {
  const panel = new SettingsAppearancePanel();
  panel.themes = [theme("pi-web-dark"), theme("paper", { colorScheme: "light" })];
  configure(panel);
  document.body.append(panel);
  await panel.updateComplete;
  return panel;
}

function cards(panel: SettingsAppearancePanel): HTMLButtonElement[] {
  return [...(panel.shadowRoot?.querySelectorAll<HTMLButtonElement>(".theme") ?? [])];
}

describe("settings-appearance-panel", () => {
  it("lists every contributed theme, whoever contributed it", async () => {
    const panel = await mount((element) => {
      element.themes = [...element.themes, theme("from-a-plugin", { name: "From a plugin" })];
    });

    expect(cards(panel).map((card) => card.querySelector(".theme-name")?.textContent)).toEqual(["pi-web-dark", "paper", "From a plugin"]);
  });

  it("previews the colours a theme will apply rather than naming it alone", async () => {
    const panel = await mount((element) => {
      element.themes = [theme("accented", { tokens: tokens({ "--pi-accent": "#ff0066", "--pi-bg": "#001122" }) })];
    });

    const preview = cards(panel)[0]?.querySelector<HTMLElement>(".preview");
    expect(preview?.getAttribute("style")).toContain("--preview-accent: #ff0066");
    expect(preview?.getAttribute("style")).toContain("--preview-bg: #001122");
  });

  it("reports the chosen theme, and says when another one is in use", async () => {
    const panel = await mount((element) => {
      element.selectedThemeId = themeId("pi-web-dark");
      element.activeThemeId = themeId("paper");
    });

    expect(cards(panel)[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(cards(panel)[1]?.textContent).toContain("in use");
  });

  it("selects a theme by pressing its card", async () => {
    const onSelectTheme = vi.fn<(id: QualifiedContributionId) => void>();
    const panel = await mount((element) => { element.onSelectTheme = onSelectTheme; });

    cards(panel)[1]?.click();

    expect(onSelectTheme).toHaveBeenCalledWith("themes:paper");
  });

  it("offers following the system as a switch, not a hidden mode", async () => {
    const onToggleFollowSystem = vi.fn<(follow: boolean) => void>();
    const panel = await mount((element) => { element.followSystem = false; element.onToggleFollowSystem = onToggleFollowSystem; });

    const checkbox = panel.shadowRoot?.querySelector<HTMLInputElement>(".follow input");
    expect(checkbox?.checked).toBe(false);
    if (checkbox === null || checkbox === undefined) throw new Error("Expected the follow-system switch");
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("change"));

    expect(onToggleFollowSystem).toHaveBeenCalledWith(true);
  });

  it("says so when no themes are installed", async () => {
    const panel = await mount((element) => { element.themes = []; });
    expect(panel.shadowRoot?.textContent).toContain("No themes are installed");
  });
});
