import { html, nothing, type TemplateResult } from "lit";
import type { ChatLine } from "./shared";
import { askPlugin } from "../plugins/pluginContainment";
import type { ContributionPresentation, MessageActionRole, MessageActionRow, QualifiedMessageActionContribution } from "../plugins/types";

const ROLE_OF: Readonly<Partial<Record<ChatLine["role"], MessageActionRole>>> = { assistant: "assistant", user: "user" };

/** The role a plugin action may name for a row, or undefined for a row no plugin action is drawn on. */
export function messageActionRole(line: ChatLine): MessageActionRole | undefined {
  return ROLE_OF[line.role];
}

/**
 * The plugin buttons of one transcript row, in the host's own `.msg-action` box so they take its
 * size and its coarse-pointer reach. An action whose `available` says no is absent; a `run` that
 * throws or rejects is handed to `onFailed`, which tells the reader.
 */
export function renderPluginMessageActions(
  actions: readonly QualifiedMessageActionContribution[],
  row: MessageActionRow,
  onFailed: (action: QualifiedMessageActionContribution, error: unknown) => void,
): TemplateResult[] {
  return actions.flatMap((action) => {
    if (!action.roles.includes(row.role)) return [];
    if (askPlugin(action, "available", "its button is not drawn on this row", () => action.available?.(row) ?? true) !== true) return [];
    const shown: ContributionPresentation = askPlugin(action, "presentation", "its button is drawn with its default title and icon", () => action.presentation?.(row)) ?? {};
    const title = shown.title ?? action.title;
    const run = (event: MouseEvent) => {
      event.stopPropagation();
      void Promise.resolve().then(() => action.run(row)).catch((error: unknown) => { onFailed(action, error); });
    };
    return [html`<button type="button" class="msg-action" data-plugin-action=${action.id} title=${title} aria-label=${title} aria-pressed=${shown.pressed === undefined ? nothing : String(shown.pressed)} @click=${run}>
      <span class="msg-action-icon" aria-hidden="true">${shown.icon ?? action.icon}</span>
    </button>`];
  });
}
