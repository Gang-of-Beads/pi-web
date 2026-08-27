/**
 * Whether opening a full-screen surface should take focus off what has it.
 *
 * Opening a chooser while the composer still holds focus leaves the on-screen
 * keyboard up, covering the list the chooser exists to show. On a phone the
 * first thing after tapping "switch session" is then to dismiss a keyboard
 * nobody asked for.
 *
 * Only text entry raises that keyboard, so only text entry is blurred. Taking
 * focus off a button would cost someone on a physical keyboard their place in
 * the tab order, and they have no on-screen keyboard in the way to begin with.
 */
export interface FocusedElementFacts {
  readonly tagName: string;
  readonly type?: string;
  readonly isContentEditable?: boolean;
}

const KEYBOARD_RAISING_INPUT_TYPES = new Set([
  "text", "search", "email", "url", "tel", "password", "number", undefined,
]);

export function shouldDismissKeyboard(focused: FocusedElementFacts | undefined): boolean {
  if (focused === undefined) return false;
  if (focused.isContentEditable === true) return true;
  const tag = focused.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return KEYBOARD_RAISING_INPUT_TYPES.has(focused.type);
}

/** Reads the facts off the live document and blurs when they call for it. */
export function dismissKeyboardIfRaised(root: Document = document): void {
  const active = root.activeElement;
  if (active === null) return;
  const facts: FocusedElementFacts = {
    tagName: active.tagName,
    ...(active instanceof HTMLInputElement ? { type: active.type } : {}),
    ...(active instanceof HTMLElement ? { isContentEditable: active.isContentEditable } : {}),
  };
  if (!shouldDismissKeyboard(facts)) return;
  if (active instanceof HTMLElement) active.blur();
}

/**
 * What the session switcher should focus when it opens.
 *
 * Focusing the search box is right where typing is how you got there: the
 * shortcut opens the switcher and the reader carries on typing. On a touch
 * screen it raised the on-screen keyboard over the list the switcher exists to
 * show, hiding half the sessions behind a keyboard nobody asked for, when the
 * reader usually just wants to tap one. The keyboard is one tap away for
 * anyone who does want to search.
 */
export function switcherInitialFocus(environment: { touchPrimary: boolean }): string | undefined {
  return environment.touchPrimary ? undefined : "input";
}

/** Whether this device's main pointer is a finger. */
export function touchPrimaryPointer(view: Pick<Window, "matchMedia"> = window): boolean {
  return view.matchMedia("(pointer: coarse)").matches;
}
