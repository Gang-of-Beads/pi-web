// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import "./AppGoToSheet";
import type { AppGoToSheet } from "./AppGoToSheet";

/**
 * Owner report: the Go to sheet had no key at all, so the press that opened
 * it had nowhere to land on the way back. The key keeps its place in the
 * sheet, and the bar key is a toggle (wired in the shell).
 */
async function mount(patch: Partial<AppGoToSheet> = {}): Promise<AppGoToSheet> {
  const sheet = document.createElement("app-go-to-sheet");
  Object.assign(sheet, patch);
  document.body.append(sheet);
  await sheet.updateComplete;
  return sheet;
}

describe("the Go to sheet's own key", () => {
  it("closes the sheet", async () => {
    const closes: number[] = [];
    const sheet = await mount({ destinations: [], onClose: () => { closes.push(1); } });

    const key = sheet.renderRoot.querySelector<HTMLButtonElement>(".panel-key");

    expect(key).not.toBeNull();
    expect(key?.getAttribute("aria-label")).toBe("Close Go to");
    key?.click();
    expect(closes).toEqual([1]);
    sheet.remove();
  });
});
