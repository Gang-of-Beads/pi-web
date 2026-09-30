/**
 * Whether an input method owns this key, so the dialog must not act on it.
 *
 * The plugin's copy of the host's `keyBelongsToInputMethod` (plugins import nothing from
 * the host's source). A Chinese, Japanese or Korean IME confirms a candidate with Enter;
 * some browsers deliver that keydown just after `compositionend` without `isComposing`,
 * but always with `keyCode` 229.
 */
export function keyBelongsToInputMethod(event: Pick<KeyboardEvent, "isComposing" | "keyCode">): boolean {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229 is the only mark some browsers put on an IME-confirming Enter.
  return event.isComposing || event.keyCode === 229;
}
