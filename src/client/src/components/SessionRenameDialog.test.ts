// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRenameDialog } from "./SessionRenameDialog";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

async function mountDialog(sessionName: string): Promise<SessionRenameDialog> {
  const dialog = new SessionRenameDialog();
  dialog.sessionName = sessionName;
  document.body.append(dialog);
  await dialog.updateComplete;
  return dialog;
}

function required<T extends Element>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Expected ${label}`);
  return value;
}

function input(dialog: SessionRenameDialog): HTMLInputElement {
  return required(dialog.shadowRoot?.querySelector<HTMLInputElement>("input"), "the rename dialog's input");
}

function submitButton(dialog: SessionRenameDialog): HTMLButtonElement {
  const button = [...(dialog.shadowRoot?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent.trim() === "Rename");
  return required(button, "the rename dialog's Rename button");
}

describe("the session rename dialog", () => {
  it("seeds the field with the current name and selects it, so a rename edits rather than retypes", async () => {
    const dialog = await mountDialog("Weekend refactor");
    expect(input(dialog).value).toBe("Weekend refactor");
  });

  it("sends the trimmed name on submit", async () => {
    const onSubmit = vi.fn<(name: string) => Promise<void>>();
    const dialog = await mountDialog("Weekend refactor");
    dialog.onSubmit = onSubmit;
    input(dialog).value = "  Shipped refactor  ";
    input(dialog).dispatchEvent(new Event("input"));
    await dialog.updateComplete;
    submitButton(dialog).click();
    await dialog.updateComplete;
    expect(onSubmit).toHaveBeenCalledWith("Shipped refactor");
  });

  it("disables the send for an unchanged name instead of silently dropping it", async () => {
    const onSubmit = vi.fn<(name: string) => Promise<void>>();
    const dialog = await mountDialog("Weekend refactor");
    dialog.onSubmit = onSubmit;
    await dialog.updateComplete;
    expect(submitButton(dialog).hasAttribute("disabled")).toBe(true);
  });

  it("disables the send for an empty name, so a rename cannot clear a name by accident", async () => {
    const onSubmit = vi.fn<(name: string) => Promise<void>>();
    const dialog = await mountDialog("Weekend refactor");
    dialog.onSubmit = onSubmit;
    input(dialog).value = "   ";
    input(dialog).dispatchEvent(new Event("input"));
    await dialog.updateComplete;
    expect(submitButton(dialog).hasAttribute("disabled")).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("routes cancel and the surface's close request to onCancel", async () => {
    const onCancel = vi.fn();
    const dialog = await mountDialog("Weekend refactor");
    dialog.onCancel = onCancel;
    const cancel = required([...(dialog.shadowRoot?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent.trim() === "Cancel"), "the rename dialog rendered no Cancel button".slice(1, -1));
    cancel.click();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

