/**
 * Whether the reader sees the conversation, so a text selection made in it can be let go once
 * they do not (`letGoOfTouchSelection`).
 *
 * A page can cover the conversation - the navigation list, Go to, the context sheet, session
 * search, Settings - or the layout can show another page in its place: the phone's session list,
 * a workspace or plugin page where the window is too narrow for both, a page expanded to the whole
 * canvas, or nothing at all when no session is open. Each is reached by a tap, a key, Back,
 * Forward or a URL; the first fix let go from four openers only, so Settings and the pages shown
 * in the conversation's place kept the selection (r176, r198). Each of these pages ends in one of
 * these states, so the app lets go when the state leaves `shown`, whatever led there. Dialogs,
 * pickers and sheets are not pages and are not followed here.
 *
 * `replaced` reads what the stylesheet hides the chat under: `navigation-view` in the phone layout,
 * `workspace-view` when the window is not wide enough for side by side, and the shell of a page
 * holding the canvas (`workspace-panel-fullscreen`). `covered` and `replaced` both let go; they are
 * named apart because one is a page drawn over the chat and the other the chat not drawn at all.
 */
import type { mainViewClass } from "./appShell/panelCollapseController";

export type ConversationPresence = "shown" | "covered" | "replaced";

export interface ConversationPresenceFacts {
  /** A session's chat is rendered at all. */
  readonly hasChat: boolean;
  readonly viewClass: ReturnType<typeof mainViewClass>;
  readonly phoneLayout: boolean;
  readonly sideBySide: boolean;
  /** A page that covers the conversation is open. */
  readonly coveringPageOpen: boolean;
  /** A workspace page holds the whole canvas (`workspacePanelHoldsCanvas`), which hides the main area. */
  readonly canvasHeld: boolean;
}

export function conversationPresence(facts: ConversationPresenceFacts): ConversationPresence {
  if (!facts.hasChat || facts.canvasHeld) return "replaced";
  if (facts.viewClass === "navigation-view" && facts.phoneLayout) return "replaced";
  if (facts.viewClass === "workspace-view" && !facts.sideBySide) return "replaced";
  return facts.coveringPageOpen ? "covered" : "shown";
}

/** Only leaving the conversation lets go; moving between pages that already hide it changes nothing. */
export function leavesConversation(previous: ConversationPresence, next: ConversationPresence): boolean {
  return previous === "shown" && next !== "shown";
}
