/**
 * Whether the message composer should step aside for another input.
 *
 * On a phone the composer and its action row take about a third of what is
 * left above the keyboard. While a question form or an extension dialog is
 * being answered none of that is usable, and the answer field is squeezed into
 * what remains. Collapsing the composer to one line while such a field has
 * focus gives the space to the input actually in use.
 *
 * Focus is the trigger rather than the mere presence of a form: a form on
 * screen that nobody is typing into should not take the composer away.
 */
const COLLAPSING_HOSTS = ["ask-user-card", "extension-dialog-card"];

export function composerCollapsedForFocus(path: readonly EventTarget[]): boolean {
  return path.some((target) => COLLAPSING_HOSTS.includes(elementTagName(target)));
}

/**
 * The ancestor chain of an element that focus is moving to, in the same shape
 * as `composedPath()`, so leaving a form can be judged by the same rule that
 * entering it was.
 */
export function composedPathOf(target: EventTarget | null): EventTarget[] {
  const path: EventTarget[] = [];
  let node: Node | null = target instanceof Node ? target : null;
  while (node !== null) {
    path.push(node);
    node = node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);
  }
  return path;
}

function elementTagName(target: EventTarget): string {
  return target instanceof Element ? target.tagName.toLowerCase() : "";
}
