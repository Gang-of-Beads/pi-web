// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandOption } from "../api";
import { CommandPicker } from "./CommandPicker";
import { deepActiveElement, dialogSurface, pressKey, pressNativeButtonEnter, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("command-picker modal surface", () => {

  it("focuses the options list when opened without search", async () => {
    const picker = await mountPicker();

    expect(deepActiveElement()).toBe(optionsList(picker));
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn<() => void>();
    const picker = await mountPicker({ onCancel });

    pressKey(dialogSurface(picker), "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels when the backdrop itself is pressed", async () => {
    const onCancel = vi.fn<() => void>();
    const picker = await mountPicker({ onCancel });

    surfaceBackdrop(picker).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps arrow navigation and Enter picking on the option-list context", async () => {
    const onPick = vi.fn<(value: string) => void>();
    const picker = await mountPicker({ onPick, options: [option("a", "Alpha"), option("b", "Beta"), option("c", "Gamma")] });
    expect(selectedOptionIndex(picker)).toBe(0);

    pressKey(dialogSurface(picker), "ArrowDown");
    await settleRenderedDialog(picker);
    expect(selectedOptionIndex(picker)).toBe(1);

    pressKey(dialogSurface(picker), "ArrowUp");
    await settleRenderedDialog(picker);
    expect(selectedOptionIndex(picker)).toBe(0);

    pressKey(dialogSurface(picker), "ArrowUp");
    await settleRenderedDialog(picker);
    expect(selectedOptionIndex(picker)).toBe(2);

    pressKey(dialogSurface(picker), "Enter");

    expect(onPick).toHaveBeenCalledWith("c");
  });

  it("lets a focused option and Close button keep their native Enter meanings", async () => {
    const onPick = vi.fn<(value: string) => void>();
    const onCancel = vi.fn<() => void>();
    const picker = await mountPicker({ onPick, onCancel });
    const secondOption = requiredElement(optionButtons(picker)[1], "second command option");

    expect(selectedOptionIndex(picker)).toBe(0);
    secondOption.focus();
    await settleRenderedDialog(picker);
    expect(selectedOptionIndex(picker)).toBe(1);
    expect(secondOption.getAttribute("aria-current")).toBe("true");

    const optionEvent = pressNativeButtonEnter(secondOption);
    expect(optionEvent.defaultPrevented).toBe(false);
    expect(onPick).toHaveBeenCalledWith("b");

    const close = closeButton(picker);
    close.focus();
    const closeEvent = pressNativeButtonEnter(close);

    expect(closeEvent.defaultPrevented).toBe(false);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onPick).toHaveBeenCalledTimes(1);
  });
});

interface CommandPickerProps {
  title?: string;
  options?: CommandOption[];
  onPick?: (value: string) => void;
  onCancel?: () => void;
}

async function mountPicker(props: CommandPickerProps = {}): Promise<CommandPicker> {
  const picker = new CommandPicker();
  picker.options = props.options ?? [option("a", "Alpha"), option("b", "Beta")];
  if (props.title !== undefined) picker.title = props.title;
  if (props.onPick !== undefined) picker.onPick = props.onPick;
  if (props.onCancel !== undefined) picker.onCancel = props.onCancel;
  document.body.append(picker);
  await settleRenderedDialog(picker);
  return picker;
}

function option(value: string, label: string): CommandOption {
  return { value, label };
}

function optionsList(picker: CommandPicker): HTMLElement {
  return requiredElement(picker.shadowRoot?.querySelector<HTMLElement>(".options"), "command-picker options list");
}

function optionButtons(picker: CommandPicker): HTMLButtonElement[] {
  return [...(picker.shadowRoot?.querySelectorAll<HTMLButtonElement>(".options button") ?? [])];
}

function closeButton(picker: CommandPicker): HTMLButtonElement {
  return requiredElement(picker.shadowRoot?.querySelector<HTMLButtonElement>("header button[aria-label='Close']"), "command-picker Close button");
}

function selectedOptionIndex(picker: CommandPicker): number {
  return optionButtons(picker).findIndex((button) => button.classList.contains("selected"));
}

/** Type into the picker's search box and let it re-render. */
