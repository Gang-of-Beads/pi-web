// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configApi, piPackagesApi, pluginsApi } from "../api";
import { deepActiveElement, dialogSection, dialogSurface, pressKey, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";
import { SettingsDialog } from "./SettingsDialog";
import { configResponse, pluginsResponse } from "./SettingsDialog.testSupport";
import type { SettingsSection } from "../settingsRoute";

beforeEach(() => {
  // The dialog loads gateway and selected-machine settings data when it
  // connects; stub those boundary calls so the shell tests stay deterministic.
  vi.spyOn(configApi, "config").mockResolvedValue(configResponse({}));
  vi.spyOn(pluginsApi, "plugins").mockResolvedValue(pluginsResponse([]));
  vi.spyOn(piPackagesApi, "packages").mockResolvedValue({ packages: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
});

describe("settings-dialog modal surface", () => {
  it("moves focus into the labelled dialog when opened", async () => {
    const dialog = await mountDialog();

    expect(deepActiveElement()).toBe(dialogSection(dialog));
    expect(dialogSection(dialog).getAttribute("aria-label")).toBe("PI WEB settings");
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    pressKey(dialogSurface(dialog), "Escape");

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes when the backdrop itself is pressed", async () => {
    const onClose = vi.fn<() => void>();
    const dialog = await mountDialog({ onClose });

    surfaceBackdrop(dialog).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("moves focus from the dialog section to the first dialog control on Tab", async () => {
    const dialog = await mountDialog();
    const closeButton = requiredElement(dialog.shadowRoot?.querySelector<HTMLButtonElement>("header .close-button"), "settings close button");
    expect(deepActiveElement()).toBe(dialogSection(dialog));

    pressKey(dialogSurface(dialog), "Tab");

    expect(deepActiveElement()).toBe(closeButton);
  });
});

describe("settings-dialog phone drill-down", () => {
  function stubPhone(): void {
    vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
      matches: query.includes("pointer: coarse") || query.includes("max-width: 760px"),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }));
  }

  it("opens on the section list without a tab strip", async () => {
    stubPhone();
    const dialog = await mountDialog();

    const list = requiredElement(dialog.shadowRoot?.querySelector<HTMLElement>(".settings-list"), "settings list");
    const rows = Array.from(list.querySelectorAll("button"));
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toContain("General");
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toContain("Appearance");
    expect(dialog.shadowRoot?.querySelector(".settings-nav")).toBeNull();
  });

  it("navigates from a list row and returns through the back control", async () => {
    stubPhone();
    const onNavigate = vi.fn<(section: SettingsSection) => void>();
    const dialog = await mountDialog({ onNavigate });

    const appearanceRow = requiredElement(
      Array.from(dialog.shadowRoot?.querySelectorAll<HTMLElement>(".settings-list button") ?? []).find((row) => row.querySelector("strong")?.textContent === "Appearance"),
      "appearance row",
    );
    appearanceRow.click();
    expect(onNavigate).toHaveBeenCalledWith("appearance");

    const onBackToList = vi.fn<() => void>();
    const drilled = await mountDialog({ onBackToList, section: "appearance" });
    const back = requiredElement(drilled.shadowRoot?.querySelector<HTMLButtonElement>(".settings-back"), "settings back");
    expect(drilled.shadowRoot?.querySelector(".settings-nav")).toBeNull();
    back.click();
    expect(onBackToList).toHaveBeenCalledOnce();
  });

  it("falls back to General when the desktop opens without a section", async () => {
    const dialog = await mountDialog({ section: undefined });

    const nav = requiredElement(dialog.shadowRoot?.querySelector<HTMLElement>(".settings-nav"), "settings nav");
    const selected = requiredElement(nav.querySelector("button.selected"), "selected nav button");
    expect(selected.textContent).toContain("General");
  });
});

interface SettingsDialogCallbacks {
  onClose?: () => void;
  onNavigate?: (section: SettingsSection) => void;
  onBackToList?: () => void;
  section?: SettingsSection | undefined;
}

async function mountDialog(callbacks: SettingsDialogCallbacks = {}): Promise<SettingsDialog> {
  const dialog = new SettingsDialog();
  Object.assign(dialog, callbacks);
  document.body.append(dialog);
  await settleRenderedDialog(dialog);
  return dialog;
}
