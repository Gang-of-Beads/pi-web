// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandOption } from "../api";
import { CommandPicker } from "./CommandPicker";
import { deepActiveElement, dialogSection, dialogSurface, pressKey, pressNativeButtonEnter, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("command-picker modal surface", () => {
  it("focuses the search input when opened searchable", async () => {
    const picker = await mountPicker({ searchable: true, title: "Pick a model" });

    expect(deepActiveElement()).toBe(searchInput(picker));
    expect(dialogSection(picker).getAttribute("aria-label")).toBe("Pick a model");
  });

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

  it("keeps broadened option navigation available from the search input", async () => {
    const onPick = vi.fn<(value: string) => void>();
    const picker = await mountPicker({ searchable: true, onPick });

    pressKey(searchInput(picker), "ArrowDown");
    await settleRenderedDialog(picker);
    const event = pressKey(searchInput(picker), "Enter");

    expect(event.defaultPrevented).toBe(true);
    expect(onPick).toHaveBeenCalledWith("b");
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
  searchable?: boolean;
  options?: CommandOption[];
  onPick?: (value: string) => void;
  onCancel?: () => void;
}

async function mountPicker(props: CommandPickerProps = {}): Promise<CommandPicker> {
  const picker = new CommandPicker();
  picker.options = props.options ?? [option("a", "Alpha"), option("b", "Beta")];
  if (props.title !== undefined) picker.title = props.title;
  if (props.searchable !== undefined) picker.searchable = props.searchable;
  if (props.onPick !== undefined) picker.onPick = props.onPick;
  if (props.onCancel !== undefined) picker.onCancel = props.onCancel;
  document.body.append(picker);
  await settleRenderedDialog(picker);
  return picker;
}

function option(value: string, label: string): CommandOption {
  return { value, label };
}

function searchInput(picker: CommandPicker): HTMLInputElement {
  return requiredElement(picker.shadowRoot?.querySelector<HTMLInputElement>("input"), "command-picker search input");
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

describe("command-picker fuzzy model search", () => {
  it("finds a model from two remembered fragments and ranks the named account first", async () => {
    const picker = await mountPicker({ title: "Select Model", searchable: true, options: [
      { value: "anthropic-personal/claude-opus-5", label: "claude-opus-5", description: "anthropic-personal" },
      { value: "anthropic-work/claude-opus-5", label: "claude-opus-5", description: "anthropic-work" },
      { value: "anthropic-work/claude-haiku-4-5", label: "claude-haiku-4-5", description: "anthropic-work" },
    ] });

    await search(picker, "opus-5 work");

    // Neither fragment order nor contiguity holds in the option's text, so a
    // plain substring filter finds nothing here.
    expect(optionValues(picker)).toEqual(["anthropic-work/claude-opus-5"]);
  });

  it("lists every account's copy when only the model is named", async () => {
    const picker = await mountPicker({ title: "Select Model", searchable: true, options: [
      { value: "anthropic-personal/claude-opus-5", label: "claude-opus-5", description: "anthropic-personal" },
      { value: "anthropic-work/claude-opus-5", label: "claude-opus-5", description: "anthropic-work" },
      { value: "github-copilot/gpt-5.4", label: "gpt-5.4", description: "github-copilot" },
    ] });

    await search(picker, "opus");

    expect(optionValues(picker)).toEqual([
      "anthropic-personal/claude-opus-5",
      "anthropic-work/claude-opus-5",
    ]);
  });

  it("reports no matches for a query nothing satisfies", async () => {
    const picker = await mountPicker({ title: "Select Model", searchable: true, options: [
      { value: "anthropic/claude-opus-5", label: "claude-opus-5", description: "anthropic" },
    ] });

    await search(picker, "gemini");

    expect(optionValues(picker)).toEqual([]);
  });
});

/** Type into the picker's search box and let it re-render. */
async function search(picker: CommandPicker, query: string): Promise<void> {
  const root = picker.shadowRoot;
  if (root === null) throw new Error("Expected command-picker shadow root");
  const input = root.querySelector("input");
  if (input === null) throw new Error("Expected a search input");
  input.value = query;
  input.dispatchEvent(new Event("input"));
  await picker.updateComplete;
}

/**
 * Options as `description/label`, which for the model picker reconstructs the
 * `provider/model-id` reference the option would insert.
 */
function optionValues(picker: CommandPicker): string[] {
  const root = picker.shadowRoot;
  if (root === null) throw new Error("Expected command-picker shadow root");
  return [...root.querySelectorAll(".options button")].map((button) => {
    const label = button.querySelector("span")?.textContent.trim() ?? "";
    const description = button.querySelector("small")?.textContent.trim() ?? "";
    return description === "" ? label : `${description}/${label}`;
  });
}
