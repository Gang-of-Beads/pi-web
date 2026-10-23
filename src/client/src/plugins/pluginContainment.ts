import { html, type TemplateResult } from "lit";
import { describeError } from "../notice";

/**
 * One containment rule for every plugin callback the host calls while it draws (r149).
 *
 * A plugin's callback runs inside the host's render: one that throws there used to stop the whole
 * app from updating (a global page's `visible` is read while PiWebApp draws). Asked through here, a
 * throw costs only what that one answer would have drawn: a predicate fails closed, a content
 * callback draws nothing or a note, and the rest of the list, menu, page or row draws as if that
 * callback had not answered.
 *
 * Each failure is logged once per contribution object and member, since the host asks on every
 * draw and a broken plugin would otherwise flood the console; the memory is per contribution
 * object, so a plugin registered again logs afresh.
 */
const logged = new WeakMap<object, Set<string>>();

/** A plugin's answer, or `undefined` when its callback throws, which is logged once with what the host does instead. */
export function askPlugin<T>(contribution: { readonly id: string }, member: string, consequence: string, read: () => T): T | undefined {
  return askPluginOr(contribution, member, consequence, read, () => undefined);
}

/** A plugin's answer, or what `fallback` makes of the error when its callback throws, which is logged once. */
export function askPluginOr<T, F>(contribution: { readonly id: string }, member: string, consequence: string, read: () => T, fallback: (error: unknown) => F): T | F {
  try {
    return read();
  } catch (error) {
    reportPluginFailure(contribution, contribution.id, member, consequence, error);
    return fallback(error);
  }
}

/** A failure the host caught itself (an async answer that rejected), logged once per `key` object and member like the others. */
export function reportPluginFailure(key: object, id: string, member: string, consequence: string, error: unknown): void {
  const members = logged.get(key) ?? new Set<string>();
  logged.set(key, members);
  if (members.has(member)) return;
  members.add(member);
  console.error(`[plugin] ${id} failed to answer ${member}; ${consequence}`, error);
}

/** The words the host shows in place of a plugin page or section whose `render` threw. */
export function pluginDrawFailureText(title: string, error: unknown): string {
  return `${title} could not be drawn: ${describeError(error)}`;
}

/** The note a page draws in place of its content when its `render` throws, in the page's empty-state look. */
export function pluginPageDrawFailure(title: string, error: unknown): TemplateResult {
  return html`<section class="empty-state" role="status"><p>${pluginDrawFailureText(title, error)}</p></section>`;
}

