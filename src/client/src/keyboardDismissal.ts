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

/**
 * Reads the facts off the live document and blurs when they call for it: a surface that covers
 * the conversation calls this as it opens. It does not see into the app's shadow roots; the
 * tapped key takes the composer's focus.
 */
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
 * On a touch screen, let go of a text selection that is a range. Android draws its selection
 * handles and Copy bar above everything, so text selected in a message stayed marked over the page
 * that took the conversation's place (owner, 2026-10-31, r176; again 2026-11-11, r198). Under a
 * mouse a selection draws no handles and stays, as it did.
 *
 * `type`, not `isCollapsed`, says whether there is one. A message's text lives inside the app's
 * shadow roots, and Chromium reports such a selection through `document.getSelection()` with both
 * ends moved out to the outermost host: anchor the body, `isCollapsed` true, while `type` stays
 * "Range" (Chromium 159 for Android, 2026-11-11). Testing `isCollapsed` never let any of them go.
 * A caret is not a range, so a focused composer keeps its caret.
 */
export function letGoOfTouchSelection(root: Document = document, touchPrimary: boolean = touchPrimaryPointer()): void {
  if (!touchPrimary) return;
  const selection = root.getSelection();
  if (selection?.type === "Range") selection.removeAllRanges();
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

/**
 * Whether this device's main pointer is a finger.
 *
 * Reports false where the question cannot be asked - a test DOM without
 * `matchMedia`, an older engine - because that is the answer that keeps a
 * keyboard-driven environment behaving as it did.
 */
export function touchPrimaryPointer(view: Partial<Pick<Window, "matchMedia">> = window): boolean {
  return typeof view.matchMedia === "function" && view.matchMedia("(pointer: coarse)").matches;
}
