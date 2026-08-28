// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppAction } from "../actions";
import { ActionPalette, filterActionPaletteActions } from "./ActionPalette";
import { deepActiveElement, dialogSection, dialogSurface, pressKey, pressNativeButtonEnter, requiredElement, settleRenderedDialog, surfaceBackdrop } from "./modalSurfaceTestSupport";

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
});

describe("filterActionPaletteActions", () => {
  it("keeps disabled actions visible when they have an explanation", () => {
    const actions: AppAction[] = [
      action("enabled", "Enabled action"),
      action("hidden", "Disabled without reason", { enabled: false }),
      action("explained", "Disabled with reason", { enabled: false, disabledReason: "Update and restart the selected machine." }),
    ];

    expect(filterActionPaletteActions(actions, "").map((item) => item.id)).toEqual(["enabled", "explained"]);
  });

  it("matches disabled reasons in search", () => {
    const actions: AppAction[] = [
      action("cleanup", "Clean Up Sessions", { enabled: false, disabledReason: "Selected server does not support cleanup." }),
    ];

    expect(filterActionPaletteActions(actions, "support cleanup").map((item) => item.id)).toEqual(["cleanup"]);
  });

  /**
   * The palette's first entry was "Show Actions / Open the command palette",
   * one of 36: an offer to open the surface the reader is already looking at.
   * The action itself stays registered because it owns the Ctrl+K shortcut
   * that opens the palette from everywhere else - it just does not list
   * itself.
   */
  it("does not offer to open the surface it is already showing", () => {
    const actions: AppAction[] = [
      action("core:actions.show", "Show actions", { description: "Open the command palette" }),
      action("core:prompt.focus", "Focus prompt"),
    ];

    expect(filterActionPaletteActions(actions, "").map((item) => item.id)).toEqual(["core:prompt.focus"]);
  });

  it("hides it however the plugin id is namespaced", () => {
    const actions: AppAction[] = [action("actions.show", "Show actions")];

    expect(filterActionPaletteActions(actions, "")).toEqual([]);
  });

  // Someone recalls the words an action is made of, not the order the title
  // puts them in, so the words are asked for one at a time.
  it("matches words typed in any order", () => {
    const actions: AppAction[] = [
      action("cleanup", "Clean Up Sessions"),
      action("new", "New Session"),
    ];

    expect(filterActionPaletteActions(actions, "sessions clean").map((item) => item.id)).toEqual(["cleanup"]);
    expect(filterActionPaletteActions(actions, "session new").map((item) => item.id)).toEqual(["new"]);
    // Every word still has to land somewhere.
    expect(filterActionPaletteActions(actions, "clean machine")).toEqual([]);
  });
});

describe("keyboard shortcut badges on a device with no keyboard", () => {
  /**
   * Measured on a phone: every row rendered a <kbd> the reader cannot press,
   * and the badge column held 101px open that the title needed - titles were
   * being truncated to make room for a control that does not apply.
   *
   * The badge is keyboard affordance, so it belongs to devices that have one.
   */
  it("hides the badges on a coarse pointer", () => {
    expect(coarsePointerRules()).toMatch(/kbd\s*\{[^}]*display:\s*none/u);
  });

  /**
   * Hiding the badge is only half of it: the grid still reserved the column,
   * so the title gained nothing. The row collapses to one column instead.
   */
  it("gives the reclaimed width back to the title", () => {
    expect(coarsePointerRules()).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/u);
  });
});

/** The palette's own coarse-pointer block, or "" when it has none. */
function coarsePointerRules(): string {
  const sheet = String(ActionPalette.styles);
  const start = sheet.indexOf("@media (pointer: coarse)");
  if (start === -1) return "";
  const open = sheet.indexOf("{", start);
  const close = sheet.indexOf("\n    }", open);
  return close === -1 ? "" : sheet.slice(open + 1, close);
}

describe("action-palette modal surface", () => {
  it("focuses the search input when opened", async () => {
    const palette = await mountPalette();

    expect(deepActiveElement()).toBe(searchInput(palette));
    expect(dialogSection(palette).getAttribute("aria-label")).toBe("Action palette");
  });

  it("cancels on Escape", async () => {
    const onCancel = vi.fn<() => void>();
    const palette = await mountPalette({ onCancel });

    pressKey(dialogSurface(palette), "Escape");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels when the backdrop itself is pressed", async () => {
    const onCancel = vi.fn<() => void>();
    const palette = await mountPalette({ onCancel });

    surfaceBackdrop(palette).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("keeps arrow navigation and runs the selected action on Enter", async () => {
    const onRun = vi.fn<(action: AppAction) => void>();
    const actions = [action("a", "Alpha"), action("b", "Beta"), action("c", "Gamma")];
    const palette = await mountPalette({ onRun, actions });
    expect(selectedActionIndex(palette)).toBe(0);

    pressKey(dialogSurface(palette), "ArrowDown");
    await settleRenderedDialog(palette);
    expect(selectedActionIndex(palette)).toBe(1);

    pressKey(dialogSurface(palette), "ArrowDown");
    await settleRenderedDialog(palette);
    expect(selectedActionIndex(palette)).toBe(2);

    pressKey(dialogSurface(palette), "ArrowDown");
    await settleRenderedDialog(palette);
    expect(selectedActionIndex(palette)).toBe(0);

    pressKey(dialogSurface(palette), "ArrowUp");
    await settleRenderedDialog(palette);
    expect(selectedActionIndex(palette)).toBe(2);

    pressKey(dialogSurface(palette), "Enter");

    expect(onRun).toHaveBeenCalledWith(actions[2]);
  });

  it("lets focused action and Close buttons keep their native Enter meanings", async () => {
    const onRun = vi.fn<(action: AppAction) => void>();
    const onCancel = vi.fn<() => void>();
    const actions = [action("a", "Alpha"), action("b", "Beta")];
    const palette = await mountPalette({ onRun, onCancel, actions });
    const secondAction = requiredElement(actionButtons(palette)[1], "second palette action");

    secondAction.focus();
    await settleRenderedDialog(palette);
    expect(selectedActionIndex(palette)).toBe(1);
    expect(secondAction.getAttribute("aria-current")).toBe("true");
    const actionEvent = pressNativeButtonEnter(secondAction);

    expect(actionEvent.defaultPrevented).toBe(false);
    expect(onRun).toHaveBeenCalledWith(actions[1]);

    const close = closeButton(palette);
    close.focus();
    const closeEvent = pressNativeButtonEnter(close);

    expect(closeEvent.defaultPrevented).toBe(false);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onRun).toHaveBeenCalledTimes(1);
  });
});

interface ActionPaletteProps {
  actions?: AppAction[];
  onRun?: (action: AppAction) => void;
  onCancel?: () => void;
}

async function mountPalette(props: ActionPaletteProps = {}): Promise<ActionPalette> {
  const palette = new ActionPalette();
  palette.actions = props.actions ?? [action("a", "Alpha"), action("b", "Beta")];
  if (props.onRun !== undefined) palette.onRun = props.onRun;
  if (props.onCancel !== undefined) palette.onCancel = props.onCancel;
  document.body.append(palette);
  await settleRenderedDialog(palette);
  return palette;
}

function searchInput(palette: ActionPalette): HTMLInputElement {
  return requiredElement(palette.shadowRoot?.querySelector<HTMLInputElement>("input"), "action-palette search input");
}

function actionButtons(palette: ActionPalette): HTMLButtonElement[] {
  return [...(palette.shadowRoot?.querySelectorAll<HTMLButtonElement>(".options button") ?? [])];
}

function closeButton(palette: ActionPalette): HTMLButtonElement {
  return requiredElement(palette.shadowRoot?.querySelector<HTMLButtonElement>("header button[aria-label='Close']"), "action-palette Close button");
}

function selectedActionIndex(palette: ActionPalette): number {
  return actionButtons(palette).findIndex((button) => button.classList.contains("selected"));
}

function action(id: string, title: string, patch: Partial<AppAction> = {}): AppAction {
  return { id, title, run: () => undefined, ...patch };
}
