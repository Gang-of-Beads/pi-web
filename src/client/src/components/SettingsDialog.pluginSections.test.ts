// @vitest-environment happy-dom

import { html } from "lit";
import { describe, expect, it, vi } from "vitest";
import { SettingsDialog, activeSettingsPanelTag } from "./SettingsDialog";
import { parseSettingsSection } from "../settingsRoute";
import { createPluginRuntimeContext } from "../plugins/pluginRuntimeContextTestSupport";
import type { QualifiedSettingsSectionContribution } from "../plugins/types";

function section(patch: Partial<QualifiedSettingsSectionContribution> = {}): QualifiedSettingsSectionContribution {
  return {
    id: "voice:voice",
    pluginId: "voice",
    localId: "voice",
    title: "Voice",
    render: () => html`<div class="voice-settings">Region</div>`,
    ...patch,
  };
}

async function dialogWith(sections: QualifiedSettingsSectionContribution[], active = "voice:voice"): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  dialog.pluginSections = sections;
  dialog.pluginRuntimeContext = createPluginRuntimeContext().context;
  dialog.section = parseSettingsSection(active) ?? "general";
  document.body.append(dialog);
  await dialog.updateComplete;
  return dialog;
}

describe("plugin settings sections", () => {
  it("routes a qualified section to the plugin panel", () => {
    expect(activeSettingsPanelTag("voice:voice")).toBe("settings-plugin-section");
    expect(activeSettingsPanelTag("general")).toBe("settings-general-panel");
  });

  it("parses a qualified section out of the url", () => {
    expect(parseSettingsSection("voice:voice")).toBe("voice:voice");
    expect(parseSettingsSection("nonsense section")).toBeUndefined();
  });

  it("renders the contributed body", async () => {
    const dialog = await dialogWith([section()]);

    expect(dialog.shadowRoot?.querySelector(".voice-settings")?.textContent).toBe("Region");
  });

  it("lists the contributed section in the navigation", async () => {
    const dialog = await dialogWith([section()], "general");

    const labels = [...(dialog.shadowRoot?.querySelectorAll("nav button strong") ?? [])].map((node) => node.textContent);

    expect(labels).toContain("Voice");
  });

  it("says so when the section's plugin is not present on this machine", async () => {
    const dialog = await dialogWith([]);

    expect(dialog.shadowRoot?.querySelector(".settings-plugin-section-missing")?.textContent).toContain("not available");
  });

  it("survives a section that throws while rendering", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const dialog = await dialogWith([section({ render: () => { throw new Error("boom"); } })]);

      expect(dialog.shadowRoot?.querySelector(".settings-plugin-section")?.textContent).toContain("could not be drawn");
    } finally {
      errors.mockRestore();
    }
  });
});
