import type { AppState } from "./appState";

export type WorkspaceViewTransition = "keep" | "return-to-picker";

/**
 * Decides what the main view does when the workspace scope changes under it.
 *
 * Changing workspace drops the session the reader was looking at; a chat
 * surface left pointing at nothing renders the empty invite, which on the
 * phone reads as "my sessions disappeared" because the panel that offered
 * them is no longer on screen. Returning to the picker is the honest surface
 * there. The desktop keeps the designed empty state next to its resident
 * session list, so only the mobile layout returns.
 */
export function workspaceViewTransition(input: { mobileLayout: boolean; hasSession: boolean; view: AppState["mainView"] }): WorkspaceViewTransition {
  if (!input.mobileLayout) return "keep";
  if (input.hasSession) return "keep";
  if (input.view !== "chat") return "keep";
  return "return-to-picker";
}
