// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppGoToSheet } from "./AppGoToSheet";

/**
 * The extension page: every destination by name, the current one marked,
 * a tap selects and closes, and a plugin badge shows only when it says
 * something.
 */
async function mount(onSelect = vi.fn(), onClose = vi.fn()): Promise<{ sheet: AppGoToSheet; onSelect: typeof onSelect; onClose: typeof onClose }> {
  const sheet = new AppGoToSheet();
  sheet.destinations = [
    { id: "navigation", label: "Sessions", selected: false },
    { id: "chat", label: "Chat", selected: true },
    { id: "git:workspace.git", label: "Git", badge: 3, badgeLabel: "3 changed files" },
    { id: "files:files", label: "Files", badge: 0 },
  ];
  sheet.onSelect = onSelect;
  sheet.onClose = onClose;
  document.body.append(sheet);
  await sheet.updateComplete;
  return { sheet, onSelect, onClose };
}

afterEach(() => { document.body.replaceChildren(); });

describe("the Go to sheet", () => {
  it("lists every destination by name and marks the one on screen", async () => {
    const { sheet } = await mount();
    const rows = [...sheet.renderRoot.querySelectorAll<HTMLButtonElement>("button.destination")];

    expect(rows.map((row) => row.querySelector(".destination-label")?.textContent)).toEqual(["Sessions", "Chat", "Git", "Files"]);
    expect(rows.map((row) => row.getAttribute("aria-current"))).toEqual(["false", "true", "false", "false"]);
    expect(rows[2]?.querySelector(".destination-badge")?.getAttribute("aria-label")).toBe("3 changed files");
    expect(rows[3]?.querySelector(".destination-badge")).toBeNull();
  });

  it("selects on tap and closes itself", async () => {
    const { sheet, onSelect, onClose } = await mount();

    sheet.renderRoot.querySelectorAll<HTMLButtonElement>("button.destination")[2]?.click();

    expect(onSelect).toHaveBeenCalledWith("git:workspace.git");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
