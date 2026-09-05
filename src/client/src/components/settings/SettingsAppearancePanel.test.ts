// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { QualifiedContributionId, QualifiedThemeContribution } from "../../plugins/types";
import type { PiWebPlugin, ThemeContribution, ThemeToken, ThemeTokens } from "../../plugins/types";
import { html, svg } from "lit";import { SettingsAppearancePanel } from "./SettingsAppearancePanel";

afterEach(() => {
  document.body.replaceChildren();
});

function tokensFor(bg: string): ThemeTokens {
  const tokens = { "--pi-bg": bg, "--pi-surface": bg, "--pi-surface-hover": bg, "--pi-terminal-bg": bg, "--pi-terminal-text": bg, "--pi-border": bg, "--pi-border-muted": bg, "--pi-text": bg, "--pi-text-secondary": bg, "--pi-text-bright": bg, "--pi-muted": bg, "--pi-dim": bg, "--pi-accent": bg, "--pi-accent-border": bg, "--pi-selection-bg": bg, "--pi-success": bg, "--pi-success-border": bg, "--pi-success-bg": bg, "--pi-success-surface": bg, "--pi-success-ring": bg, "--pi-warning": bg, "--pi-warning-border": bg, "--pi-warning-surface": bg, "--pi-danger": bg, "--pi-purple": bg, "--pi-purple-border": bg, "--pi-purple-surface": bg, "--pi-overlay": bg, "--pi-shadow-soft": bg, "--pi-shadow": bg, "--pi-shadow-strong": bg, "--pi-bg-overlay-soft": bg, "--pi-bg-overlay": bg, "--pi-success-bg-overlay": bg, "--pi-terminal-selection": bg };
  return tokens;
}

function pack(name: string, colorScheme: "dark" | "light", bg: string): ThemeContribution {
  return { id: name, name, colorScheme, tokens: tokensFor(bg) };
}

/**
 * A minimal contributed pack stands in for the themes plugin, which ships as
 * its own repository and package: the panel's contract is with any plugin
 * that contributes themes, not with one specific pack.
 */
const fixturePackPlugin: PiWebPlugin = {
  apiVersion: 2,
  name: "Themes",
  activate: () => ({
    contributions: {
      themes: [
        pack("fixture-dark", "dark", "#0d1117"),
        pack("fixture-light", "light", "#ffffff"),
        pack("fixture-dim", "dark", "#101216"),
      ],
    },
  }),
};

function contributedThemes(): QualifiedThemeContribution[] {
  const result = fixturePackPlugin.activate({ apiVersion: 2, pluginId: "themes", runtimePluginId: "themes", html, svg });
  return (result.contributions.themes ?? []).map((theme) => ({
    id: themeId(theme.id),
    pluginId: "themes",
    localId: theme.id,
    name: theme.name,
    colorScheme: theme.colorScheme,
    tokens: theme.tokens,
  }));
}

function tokens(overrides: Readonly<Record<ThemeToken, string>> | Partial<Record<ThemeToken, string>> = {}): ThemeTokens {
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

  it("keeps the removed interface-size control out of the panel", async () => {
    // The owner's ruling: the size slider did not apply on real devices, and
    // a control that does nothing is a lie. The panel keeps themes and the
    // system switch only.
    const panel = await mount();
    expect(panel.shadowRoot?.querySelector("input[type=range]")).toBeNull();
    expect(panel.shadowRoot?.querySelector(".scale-reset")).toBeNull();
  });
});
