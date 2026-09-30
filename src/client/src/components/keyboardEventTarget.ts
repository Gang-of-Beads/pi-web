/**
 * Whether a composed keyboard event originated from a native control with its
 * own Enter activation, including one inside an open shadow root. List-level
 * shortcuts must defer so buttons click and links navigate normally.
 */
export function keyboardEventOriginatesFromNativeActivationControl(event: KeyboardEvent): boolean {
  return event.composedPath().some((target) => target instanceof HTMLButtonElement
    || (target instanceof HTMLAnchorElement && target.hasAttribute("href")));
}

/**
 * Whether an input method owns this key, so the page must not act on it.
 *
 * Chinese, Japanese and Korean IMEs use Enter to confirm a candidate and the arrows to
 * move between candidates. Browsers mark those keydowns `isComposing`, but some deliver
 * the confirming Enter just after `compositionend`, unmarked; it still carries `keyCode`
 * 229, the code a browser gives a key the IME consumed. User report (2026-09-30): every
 * Enter that picked a Chinese word sent the message.
 */
export function keyBelongsToInputMethod(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229 is the only mark some browsers put on an IME-confirming Enter.
  return event.isComposing || event.keyCode === INPUT_METHOD_KEY_CODE;
}

const INPUT_METHOD_KEY_CODE = 229;
