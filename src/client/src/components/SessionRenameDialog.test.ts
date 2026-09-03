// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionRenameDialog } from "./SessionRenameDialog";
import "./SessionList";
import { SessionList } from "./SessionList";
import type { SessionInfo } from "../api";

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

function session(id: string, name: string | undefined): SessionInfo {
  const info: SessionInfo = {
    id,
    path: `/tmp/${id}.pi`,
    cwd: "/tmp",
    archived: false,
    created: "2026-07-20T10:00:00.000Z",
    modified: "2026-07-20T10:00:00.000Z",
    messageCount: 1,
    firstMessage: "hello",
  };
  return name === undefined ? info : { ...info, name };
}

describe("the session list hosts the rename dialog", () => {
  it("opens the project's own dialog instead of the native prompt", async () => {
    const list = new SessionList();
    list.sessions = [session("s1", "Old name")];
    document.body.append(list);
    await list.updateComplete;
    const menuToggle = required([...list.renderRoot.querySelectorAll("button")].find((candidate) => candidate.getAttribute("title") === "Session actions"), "no session actions menu toggle rendered".slice(1, -1));
    menuToggle.click();
    await list.updateComplete;
    const menuButton = required([...list.renderRoot.querySelectorAll("button")].find((candidate) => candidate.getAttribute("title") === "Give this session a name you will recognise"), "no Rename menu button rendered".slice(1, -1));
    menuButton.click();
    await list.updateComplete;
    const dialog = required(list.renderRoot.querySelector("session-rename-dialog"), "the rename dialog did not open".slice(1, -1));
    expect(dialog.sessionName).toBe("Old name");
  });

  it("hands the submitted name to onRename and closes", async () => {
    const onRename = vi.fn<(session: SessionInfo, name: string) => Promise<void>>();
    const list = new SessionList();
    list.sessions = [session("s1", "Old name")];
    list.onRename = onRename;
    document.body.append(list);
    await list.updateComplete;
    const menuToggle = required([...list.renderRoot.querySelectorAll("button")].find((candidate) => candidate.getAttribute("title") === "Session actions"), "no session actions menu toggle rendered".slice(1, -1));
    menuToggle.click();
    await list.updateComplete;
    const menuButton = required([...list.renderRoot.querySelectorAll("button")].find((candidate) => candidate.getAttribute("title") === "Give this session a name you will recognise"), "no Rename menu button rendered".slice(1, -1));
    menuButton.click();
    await list.updateComplete;
    const dialog = required(list.renderRoot.querySelector<SessionRenameDialog>("session-rename-dialog"), "the rename dialog did not open".slice(1, -1));
    const field = required(dialog.shadowRoot?.querySelector<HTMLInputElement>("input"), "the dialog rendered no input".slice(1, -1));
    field.value = "New name";
    field.dispatchEvent(new Event("input"));
    await dialog.updateComplete;
    const send = required([...(dialog.shadowRoot?.querySelectorAll("button") ?? [])].find((candidate) => candidate.textContent.trim() === "Rename"), "the dialog rendered no Rename button".slice(1, -1));
    send.click();
    await list.updateComplete;
    expect(onRename).toHaveBeenCalledTimes(1);
    expect(list.renderRoot.querySelector("session-rename-dialog")).toBeNull();
  });
});
