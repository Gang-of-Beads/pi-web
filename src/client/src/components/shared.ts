import { css, svg, type TemplateResult } from "lit";
import { sessionStateBadgeStyles as SessionStateBadgeStyles } from "./sessionStateBadgeStyles";
import type { AskUserOutcome } from "../../../shared/apiTypes";
import type { SessionWarningSeverity } from "../api";

export function renderSessionWarningIcon(severity: SessionWarningSeverity, className: string): TemplateResult {
  if (severity === "error") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="m15 9-6 6"></path>
        <path d="m9 9 6 6"></path>
      </svg>
    `;
  }
  if (severity === "info") {
    return svg`
      <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10"></circle>
        <path d="M12 11v5"></path>
        <path d="M12 8h.01"></path>
      </svg>
    `;
  }
  return svg`
    <svg class=${className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z"></path>
      <path d="M12 9v4"></path>
      <path d="M12 17h.01"></path>
    </svg>
  `;
}

export interface ToolPreview {
  diff?: string;
  firstChangedLine?: number;
  error?: string;
}

export interface ToolExecutionPart {
  type: "toolExecution";
  toolCallId?: string;
  toolName: string;
  summary: string;
  args?: unknown;
  status: "pending" | "running" | "success" | "error";
  resultText?: string;
  content?: unknown;
  details?: unknown;
  preview?: ToolPreview;
}

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }
  | { type: "thinking"; text: string }
  | { type: "skillInvocation"; name: string; location: string; content: string }
  | { type: "skillRead"; name: string; path: string; toolCallId?: string }
  | { type: "askUserRecord"; outcome: AskUserOutcome }
  | { type: "toolCall"; toolCallId?: string; toolName: string; summary: string; args?: unknown }
  | ToolExecutionPart
  | { type: "toolResult"; toolCallId?: string; toolName: string; text: string; isError: boolean; content?: unknown; details?: unknown }
  | { type: "empty" };

/**
 * Delivery state of a message this browser sent, in the order it advances.
 * Only messages sent from this browser carry one: history loaded from the
 * server is delivered by definition and stays unmarked.
 */
export type MessageDeliveryState = "sending" | "received" | "queued" | "delivered" | "failed";

export interface MessageDelivery {
  /** Correlation id minted by this browser and echoed back by the server. */
  clientMessageId: string;
  state: MessageDeliveryState;
  /** How the agent will take the message when it is still queued. */
  kind?: "steer" | "followUp";
}

export interface ChatLine {
  role: "user" | "assistant" | "tool" | "system" | "bash" | "skill";
  parts: ChatPart[];
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    /** Present only on messages this browser sent; see MessageDelivery. */
    delivery?: MessageDelivery;
    /**
     * The server's optimistic copy of an accepted prompt. The agent commits its
     * own copy later, and that copy supersedes this line rather than following
     * it - which is how the same message stops rendering twice on a client that
     * cannot correlate by id (another device, or this one after a reload).
     */
    echo?: boolean;
    model?: { provider?: string; id?: string; responseId?: string };
    /** Thinking level the assistant message was generated with, when known. */
    thinkingLevel?: string;
  };
}

export interface CompletionItem {
  kind: "command" | "file" | "model" | "history";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  cursorOffset?: number;
}

export const appStyles = css`
  /* Motion is decoration here: scroll shadows, hover fades, pulsing dots. A
     reader who asked the system for less motion gets none of it. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
  /* Mobile browsers already subtract browser controls from 100dvh; reserve bottom safe area only in standalone PWA modes. */
  :host { --pi-app-safe-area-bottom: 0px; --pi-app-keyboard-inset: 0px; position: fixed; top: 0; right: 0; left: 0; display: block; height: calc(100dvh - var(--pi-app-keyboard-inset)); box-sizing: border-box; overflow: hidden; padding: env(safe-area-inset-top) env(safe-area-inset-right) var(--pi-app-safe-area-bottom) env(safe-area-inset-left); color: var(--pi-text); background: var(--pi-bg); font: var(--pi-text-base) var(--pi-font-ui); }
  :host([pwa-display-mode]) { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  @media (display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui) {
    :host { --pi-app-safe-area-bottom: env(safe-area-inset-bottom); }
  }
  .shell { --navigation-panel-size: 340px; --workspace-panel-size: minmax(340px, 32vw); --navigation-panel-width: var(--navigation-panel-size); --workspace-panel-width: var(--workspace-panel-size); display: grid; grid-template-columns: var(--navigation-panel-width) 1px minmax(320px, 1.35fr) 1px var(--workspace-panel-width); height: 100%; min-height: 0; }
  aside { grid-column: 1; display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  aside app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  header { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-4); padding: var(--pi-space-6); border-bottom: 1px solid var(--pi-border); }
  .header-actions { display: flex; align-items: center; gap: var(--pi-space-4); }
  main { grid-column: 3; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .context-bar { position: relative; flex: 0 0 auto; min-width: 0; display: none; align-items: center; gap: 0; padding: var(--pi-space-3) 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); }
  .context-bar::before, .context-bar::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
  .context-bar::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .context-bar.can-scroll-left::before, .context-bar.can-scroll-right::after { opacity: 1; }
  .context-bar-label { display: none; }
  .context-items { flex: 1 1 auto; min-width: 0; display: flex; align-items: stretch; gap: var(--pi-space-3); margin: 0; padding: 0 var(--pi-space-4); list-style: none; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scroll-padding-inline: 8px; scrollbar-width: thin; }
  .context-bar.has-context-actions .context-items { padding-right: 52px; scroll-padding-inline: 8px 52px; }
  .context-item { flex: 0 0 auto; min-width: 0; display: flex; }
  .context-actions { position: absolute; top: 6px; right: 0; bottom: 6px; z-index: 3; display: flex; align-items: center; padding: 0 var(--pi-space-4) 0 0; pointer-events: none; }
  .context-actions::after { content: ""; position: absolute; top: 0; right: 0; bottom: 0; z-index: 0; width: 26px; background: var(--pi-bg); pointer-events: none; }
  .context-chip { flex: 0 0 auto; min-width: 0; display: inline-flex; align-items: baseline; gap: var(--pi-space-3); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-2) var(--pi-space-4); font: inherit; text-align: left; }
  .context-chip:hover { background: var(--pi-surface-hover); }
  .context-chip:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
  .context-chip.empty { border-style: dashed; color: var(--pi-muted); }
  .context-kind { display: none; }
  .context-value { min-width: 0; overflow: visible; text-overflow: clip; white-space: nowrap; }
  .mobile-tabs-frame { position: relative; display: none; flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg); }
  .mobile-tabs-frame::before, .mobile-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 20px; opacity: 0; pointer-events: none; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
  .mobile-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .mobile-tabs-frame.can-scroll-left::before, .mobile-tabs-frame.can-scroll-right::after { opacity: 1; }
  .mobile-tabs { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: var(--pi-space-3); padding: var(--pi-space-4); overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .mobile-tabs button { flex: 0 0 auto; white-space: nowrap; }
  .mobile-navigation-tab, .mobile-navigation-panel { display: none; }
  .mobile-tabs button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-badge { display: inline-block; min-width: 14px; margin-left: var(--pi-space-2); border: 1px solid var(--pi-success-border); border-radius: var(--pi-radius-pill); background: var(--pi-success-surface); color: var(--pi-success); padding: 0 var(--pi-space-3); font-size: var(--pi-text-2xs); line-height: 16px; text-align: center; }
  .navigation-panel-edge, .workspace-panel-edge { min-width: 0; min-height: 0; display: flex; align-items: center; justify-content: center; overflow: visible; background: var(--pi-border-muted); z-index: 2; }
  .navigation-panel-edge { grid-column: 2; }
  .workspace-panel-edge { grid-column: 4; }
  .navigation-panel-edge-button, .workspace-panel-edge-button { position: relative; z-index: 1; box-sizing: border-box; display: grid; place-items: center; width: 18px; height: 48px; padding: 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); background: var(--pi-bg); color: var(--pi-muted); opacity: .75; cursor: pointer; }
  .navigation-panel-edge-button:hover, .navigation-panel-edge-button:focus-visible, .workspace-panel-edge-button:hover, .workspace-panel-edge-button:focus-visible { color: var(--pi-text); background: var(--pi-surface-hover); opacity: 1; }
  .shell.navigation-panel-collapsed .navigation-panel-edge-button { transform: translateX(calc(50% - .5px)); }
  .shell.workspace-panel-collapsed .workspace-panel-edge-button { transform: translateX(calc(-50% + .5px)); }
  .navigation-panel-edge-icon, .workspace-panel-edge-icon { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  workspace-panel { grid-column: 5; min-width: 0; min-height: 0; overflow: hidden; }
  @media (min-width: 1181px) {
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    .shell.workspace-panel-collapsed { --workspace-panel-width: 0px; }
    .shell.workspace-panel-collapsed > workspace-panel { display: none; }
  }
  @media (max-width: 1180px) {
    .shell { grid-template-columns: var(--navigation-panel-width) 1px minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
    .shell.navigation-panel-collapsed { --navigation-panel-width: 0px; }
    .shell.navigation-panel-collapsed > aside { display: none; }
    aside { grid-row: 1 / 3; }
    .navigation-panel-edge { grid-row: 1 / 3; }
    main { grid-column: 3; grid-row: 1 / 3; }
    .mobile-tabs-frame { display: flex; }
    .shell.workspace-view main { grid-row: 1; min-height: auto; }
    .shell.workspace-view > workspace-panel { grid-column: 3; grid-row: 2; display: flex; border-left: 0; }
    .shell:not(.workspace-view) > workspace-panel { display: none; }
    .workspace-panel-edge { display: none; }
    main.workspace-view chat-view, main.workspace-view prompt-editor, main.workspace-view status-bar,
    main.workspace-view .empty { display: none; }
    main.workspace-view { overflow: hidden; }
  }
  @media (max-width: 760px) {
    .shell { grid-template-columns: minmax(0, 1fr); }
    aside, .navigation-panel-edge { display: none; }
    main, .shell.workspace-view > workspace-panel { grid-column: 1; }
    .context-bar { display: flex; }
    .mobile-navigation-tab { display: block; }
    main.navigation-view chat-view, main.navigation-view prompt-editor, main.navigation-view status-bar,
    main.navigation-view .empty { display: none; }
    main.navigation-view .mobile-navigation-panel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
    main.navigation-view .mobile-navigation-panel app-navigation-panel { flex: 1 1 auto; min-height: 0; }
  }
  status-bar { flex: 0 0 auto; }
  chat-view { flex: 1 1 auto; min-height: 0; overflow: hidden; }
  prompt-editor { flex: 0 0 auto; }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  .empty { margin: auto; color: var(--pi-muted); }
  .error { display: flex; gap: var(--pi-space-4); align-items: flex-start; padding: var(--pi-space-5) var(--pi-space-7); border-bottom: 1px solid var(--pi-border); color: var(--pi-danger); }
  .error.transient { color: var(--pi-warning); background: color-mix(in srgb, var(--pi-warning) 8%, transparent); }
  .error .error-text { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
  .error .error-dismiss { flex: 0 0 auto; padding: 0 var(--pi-space-3); border: 0; background: none; color: inherit; line-height: 1.4; }
  .deprecation-notice { padding: var(--pi-space-5) var(--pi-space-7); border-bottom: 1px solid var(--pi-border); color: var(--pi-warning); }
  .deprecation-notice .deprecation-notice-text { margin: 0; overflow-wrap: anywhere; }
  .deprecation-notice .deprecation-notice-text + .deprecation-notice-text { margin-top: var(--pi-space-2); }

  .self-update-banner { display: flex; align-items: center; gap: var(--pi-space-4); flex-wrap: wrap; box-sizing: border-box; margin: 0 var(--pi-space-6) var(--pi-space-5); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-lg); background: var(--pi-warning-surface); color: var(--pi-warning); padding: var(--pi-space-4) var(--pi-space-6); font-size: var(--pi-text-sm); }
  .self-update-banner.applying { border-color: var(--pi-accent-border); background: var(--pi-surface); color: var(--pi-text); }
  .self-update-banner button { min-height: 32px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; padding: var(--pi-space-2) var(--pi-space-5); }
  .self-update-banner button:hover { border-color: var(--pi-accent); }
  .self-update-banner button.skip { color: var(--pi-muted); background: transparent; }
  .self-update-banner .state-dot { background: currentColor; }
`;

export const workspacePanelStyles = css`
  /* Motion is decoration here: scroll shadows, hover fades, pulsing dots. A
     reader who asked the system for less motion gets none of it. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
  :host { display: flex; flex-direction: column; min-height: 0; color: var(--pi-text); background: var(--pi-bg); font: var(--pi-text-sm) var(--pi-font-ui); container-type: inline-size; }
  header { flex: 0 0 auto; min-width: 0; border-bottom: 1px solid var(--pi-border); }
  .workspace-header-scroll-frame { position: relative; min-width: 0; background: var(--pi-bg); }
  .workspace-header-scroll-frame::before, .workspace-header-scroll-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 18px; opacity: 0; pointer-events: none; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
  .workspace-header-scroll-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .workspace-header-scroll-frame.can-scroll-left::before, .workspace-header-scroll-frame.can-scroll-right::after { opacity: 1; }
  .workspace-header-strip { display: flex; justify-content: space-between; align-items: center; gap: var(--pi-space-4); min-width: 0; padding: var(--pi-space-4); overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; scrollbar-width: thin; }
  .tabs { flex: 0 0 auto; display: flex; gap: var(--pi-space-3); align-items: center; }
  .tabs button { flex: 0 0 auto; white-space: nowrap; }
  .tabs button.icon-tab { min-width: 34px; }
  button { display: inline-flex; align-items: center; gap: var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); cursor: pointer; }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .tab-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .tab-custom-icon { flex: 0 0 auto; width: 16px; height: 16px; display: inline-grid; place-items: center; color: currentColor; pointer-events: none; }
  .tab-custom-icon svg { width: 16px; height: 16px; pointer-events: none; }
  .tab-label { min-width: 0; }
  .tab-badge { flex: 0 0 auto; display: inline-block; min-width: 14px; border: 1px solid var(--pi-success-border); border-radius: var(--pi-radius-pill); background: var(--pi-success-surface); color: var(--pi-success); padding: 0 var(--pi-space-3); font-size: var(--pi-text-2xs); line-height: 16px; text-align: center; }
  @container (max-width: 430px) {
    .tabs button.icon-tab { justify-content: center; padding-inline: var(--pi-space-4); }
    .tabs button.icon-tab .tab-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  }
  .panel-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .empty-state { box-sizing: border-box; width: min(100%, 380px); margin: auto; padding: var(--pi-space-9); display: grid; gap: var(--pi-space-4); color: var(--pi-muted); text-align: center; }
  .empty-state h2 { margin: 0; color: var(--pi-text); font-family: var(--pi-font-display); font-size: var(--pi-text-lg); font-weight: var(--pi-weight-semibold); letter-spacing: -0.01em; line-height: 1.3; }
  .empty-state p { margin: 0; line-height: 1.45; }
  small, .muted { color: var(--pi-muted); }
  @media (max-width: 1180px) { header { display: none; } }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: var(--pi-space-3); max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); }
  .toolbar button { margin-left: auto; }
  .stale { border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); color: var(--pi-warning); padding: 1px var(--pi-space-3); font-size: var(--pi-text-xs); }
  .split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(160px, 34%) minmax(0, 1fr); }
  .list { min-height: 0; overflow: auto; border-bottom: 1px solid var(--pi-border); padding: var(--pi-space-3); }
  .row { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: var(--pi-space-2); width: 100%; border: 0; border-radius: var(--pi-radius-sm); background: transparent; text-align: left; padding: 4px 6px 4px calc(6px + var(--depth, 0) * 14px); }
  .row:hover, .row.selected { background: var(--pi-selection-bg); }
  .row span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .summary { margin: var(--pi-space-2) var(--pi-space-3) var(--pi-space-4); color: var(--pi-muted); }
  /* File preview presentation lives in <workspace-file-viewer>'s own shadow root. */
  .viewer { min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  pre { margin: 0; padding: var(--pi-space-5); overflow: auto; font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
  p { margin: var(--pi-space-5); }
`;

export const listStyles = css`
  /* Mobile browsers paint a rectangular highlight on tap, which looks pasted-on
     over a round or rounded control. Suppressed in favour of the app's own
     pressed and focus styling; :focus-visible still shows keyboard focus, so
     nothing is lost for keyboard users. */
  button, [role="button"], a, summary, label, input, select { -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: inherit; }
  /* Motion is a preference, not a decoration: a user who asks for less of it
     gets none. Kept to a blanket rule because every animation here is
     ornamental — progress bars, pulses, fades — so there is no reduced variant
     worth designing separately. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { touch-action: manipulation; }
  :host { display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
  /* A host \`display\` beats the UA stylesheet's \`[hidden] { display: none }\`, so
     without this every "hidden" list still occupies its full height: the mobile
     accordion would render one visible section pushed below a screenful of
     collapsed ones. Must stay ahead of any other :host display rule. */
  :host([hidden]) { display: none; }
  :host([collapsed]) { flex: 0 0 auto; min-height: auto; overflow: hidden; }
  /* Search affordance shared by the lists that have one, so a second list does
     not drift from the first. Class named for the role, not the list. */
  .list-search { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: var(--pi-space-3); margin: 0 0 var(--pi-space-3); padding-bottom: var(--pi-space-3); background: var(--pi-bg); }
  .list-search-input { box-sizing: border-box; flex: 1 1 auto; min-width: 0; height: 34px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: 0 var(--pi-space-5); font: var(--pi-control-font-size, 14px) var(--pi-control-font-family, system-ui, sans-serif); }
  .list-search-input::placeholder { color: var(--pi-dim); }
  .list-search-input::-webkit-search-cancel-button { display: none; }
  .list-search-input:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .list-search-clear { box-sizing: border-box; flex: 0 0 auto; display: inline-grid; place-items: center; width: 34px; height: 34px; padding: 0; font-size: var(--pi-text-lg); line-height: 1; }
  .search-empty { padding: var(--pi-space-6) var(--pi-space-2); color: var(--pi-muted); }
  section { box-sizing: border-box; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: var(--pi-space-5); }
  h2 { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: center; gap: var(--pi-space-4); margin: 0 0 var(--pi-space-4); color: var(--pi-muted); font-size: var(--pi-text-xs); text-transform: uppercase; }
  /* On a phone the context row above already names the step being chosen, so a
     heading repeating that word only costs the list its first rows. The row's
     own controls (count, create, clean up) stay, so nothing is lost with it. */
  @media (max-width: 760px) {
    section { padding-top: var(--pi-space-3); }
    h2 { margin-bottom: var(--pi-space-2); }
    /* A heading that is only a word: the context row already said it. Headings
       carrying controls (count, create, clean up) are untouched. */
    h2 > span:only-child { display: none; }
    h2:has(> span:only-child) { margin: 0; }
  }
  .list-body { flex: 1 1 auto; min-height: 0; overflow: auto; }
  /* Tile/card layout for management lists (workspaces, projects, machines).
     Rows become compact cards in an auto-fill grid; the row menu moves into
     the card's corner so the two-column row grid can collapse to one. */
  .list-body.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--pi-space-4); align-content: start; padding: var(--pi-space-2) var(--pi-space-1); }
  .list-body.tiles .action-row { grid-template-columns: minmax(0, 1fr); margin: 0; align-self: start; }
  .list-body.tiles .action-main { border-radius: var(--pi-radius-lg); padding: var(--pi-space-5) 30px var(--pi-space-5) var(--pi-space-5); min-height: 56px; align-content: center; }
  .list-body.tiles .action-menu { position: absolute; top: 6px; right: 6px; align-self: auto; }
  /* In a row the toggle drops its left border on purpose: the primary region
     sits against it and draws the divider. A tile floats it in the corner with
     nothing on its left, so the same rule left the button open on one side.
     Give it back a full border and its own radius. */
  .list-body.tiles .action-menu-toggle { height: 32px; min-width: 32px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); }
  /* Touch needs a bigger target than a mouse; 32px is the smallest a finger
     hits reliably next to a tile's own tap area. */
  @media (pointer: coarse) {
    .list-body.tiles .action-menu-toggle { height: 36px; min-width: 36px; }
    .list-body.tiles .action-menu { top: 4px; right: 4px; }
  }
  .list-body.tiles .action-activity { top: 7px; right: 32px; }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  section > button { display: block; width: 100%; text-align: left; margin: var(--pi-space-3) 0; }
  .subheading { margin-top: var(--pi-space-7); }
  .section-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; justify-content: space-between; gap: var(--pi-space-4); width: 100%; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; text-transform: inherit; }
  .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-title { display: grid; gap: var(--pi-space-1); min-width: 0; }
  .section-toggle .section-selected { display: block; color: var(--pi-text); font-size: var(--pi-text-xs); font-weight: 600; line-height: 1.25; text-transform: none; }
  .section-toggle .section-count { flex: 0 0 auto; display: inline; color: var(--pi-muted); font-size: inherit; }
  .section-toggle small { display: inline; color: inherit; font-size: inherit; }
  .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: var(--pi-space-3) 0; cursor: pointer; }
  .action-row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: var(--pi-radius-md); }
  .action-row.selected .action-main, .action-row.selected .action-menu-toggle { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .action-row.archived .action-main { color: var(--pi-muted); }
  /* Written to work whether the primary region is a div or a real <button>:
     the font and cursor resets are inert on a div and stop a button from
     inheriting the UA's centred, small-font control styling. */
  .action-main { position: relative; box-sizing: border-box; min-width: 0; width: 100%; display: block; border: 1px solid var(--pi-border); border-top-right-radius: 0; border-bottom-right-radius: 0; border-top-left-radius: var(--pi-radius-md); border-bottom-left-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-9) var(--pi-space-4) calc(var(--pi-space-5) + var(--depth, 0) * var(--pi-space-7)); font: inherit; text-align: left; cursor: pointer; }
  button.action-main:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: calc(var(--pi-focus-ring-offset) * -1); }
  .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  .action-row:not(.selected):hover .action-main { background: var(--pi-surface-hover); }
  .workspace-row .action-main { border-radius: var(--pi-radius-md) 0 0 var(--pi-radius-md); }
  .workspace-primary { min-width: 0; display: flex; align-items: baseline; gap: var(--pi-space-3); }
  .workspace-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-status { flex: 0 0 auto; color: var(--pi-warning); font-size: var(--pi-text-xs); }
  .workspace-secondary { margin-top: 3px; }
  .workspace-menu-panel { width: max-content; min-width: min(120px, calc(100vw - 16px)); padding: var(--pi-space-4); }
  .workspace-menu-actions { margin: 0 0 var(--pi-space-4); padding-bottom: var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); }
  .workspace-menu-actions button.danger { color: var(--pi-danger); }
  .workspace-menu-actions button.danger:hover, .workspace-menu-actions button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
  .workspace-menu-details { display: grid; gap: var(--pi-space-3); margin: 0; }
  .workspace-detail-row { display: grid; grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); gap: var(--pi-space-4); align-items: baseline; }
  .workspace-detail-row dt { color: var(--pi-muted); font-size: var(--pi-text-xs); white-space: normal; }
  .workspace-detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: normal; }
  .action-menu-panel .detail-copy { box-sizing: border-box; display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: var(--pi-space-3); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-2xs); line-height: 1; cursor: pointer; vertical-align: middle; }
  .action-menu-panel .detail-copy:hover, .action-menu-panel .detail-copy:focus { color: var(--pi-text); border-color: var(--pi-accent); background: var(--pi-surface-hover); }
  .tree-marker { color: var(--pi-dim); margin-right: var(--pi-space-3); }
  .badge { display: inline-block; margin-left: var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); color: var(--pi-muted); padding: 0 var(--pi-space-3); font-size: var(--pi-text-2xs); font-weight: 400; }
  .action-activity { position: absolute; top: 5px; right: 6px; z-index: 1; display: grid; place-items: center; width: 10px; height: 10px; }
  .action-activity .activity-indicator { margin: 0; vertical-align: 0; }
  .activity-indicator { flex: 0 0 auto; display: inline-block; width: 7px; height: 7px; margin-right: var(--pi-space-3); background: var(--pi-success); animation: pulse 1s ease-in-out infinite; vertical-align: 1px; }
  /*
   * The state rail.
   *
   * A list of thirty sessions is read by scanning, not by inspecting, and an
   * 8px dot in the far corner of each row does not survive a scan. Each row
   * carries a coloured edge instead, taking its colour from the state the row
   * already reports: work in flight, an upload, something unread. The dot stays
   * for the detail; the rail is what the eye follows down the list, and it is
   * the one place this design spends colour on identity.
   */
  .action-row .action-main { border-left: var(--pi-rail-width, 3px) solid transparent; transition: border-left-color var(--pi-motion-fast) var(--pi-ease); }
  .action-row:has(.activity-indicator.session) .action-main { border-left-color: var(--pi-success); }
  .action-row:has(.activity-indicator.terminal) .action-main { border-left-color: var(--pi-accent); }
  .action-row:has(.activity-indicator.sending) .action-main { border-left-color: var(--pi-warning); }
  .action-row:has(.activity-indicator.unread) .action-main,
  .action-row:has(.unread-ring) .action-main { border-left-color: var(--pi-accent); }
  /* Rows report unread as their own class rather than a child indicator, so
     the rail reads it there too; the two paths cover every list. */
  .action-row.unread .action-main { border-left-color: var(--pi-accent); }
  .action-row.archived .action-main { border-left-color: var(--pi-border); }
  .action-row.selected .action-main { border-left-color: var(--pi-accent); }
  .activity-indicator.session { border-radius: 50%; background: var(--pi-success); }
  .activity-indicator.terminal { border-radius: var(--pi-radius-xs); background: var(--pi-accent); }
  /* Client-side sending (upload in flight); distinct from server activity, which propagates to workspace/machine rows. */
  .activity-indicator.sending { border-radius: 50%; background: var(--pi-warning); }
  /* Unread is a stable state, not ongoing work: keep it static and accent-colored. */
  .activity-indicator.unread { border-radius: 50%; background: var(--pi-accent); animation: none; box-shadow: 0 0 0 2px color-mix(in srgb, var(--pi-accent) 20%, transparent); }
  /* Unread + ongoing work: a static accent ring wraps the still-pulsing work dot. */
  .unread-ring { flex: 0 0 auto; box-sizing: border-box; display: inline-grid; place-items: center; width: 9px; height: 9px; margin-right: var(--pi-space-3); border: 1.5px solid var(--pi-accent); border-radius: 50%; vertical-align: 1px; }
  .unread-ring .activity-indicator { width: 5px; height: 5px; margin: 0; vertical-align: 0; }
  .action-activity .unread-ring { margin: 0; vertical-align: 0; }
  .action-menu { position: relative; align-self: stretch; }
  .action-menu-toggle { display: grid; place-items: center; height: 100%; min-width: 32px; padding: 0; color: var(--pi-muted); border-left: 0; border-top-left-radius: 0; border-bottom-left-radius: 0; }
  .action-menu-toggle:hover { color: var(--pi-text); background: var(--pi-surface-hover); }
  .action-menu-panel { position: fixed; z-index: 50; box-sizing: border-box; min-width: min(120px, calc(100vw - 16px)); overflow: auto; padding: var(--pi-space-2); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); box-shadow: 0 8px 24px var(--pi-shadow); overflow-wrap: anywhere; }
  .action-menu-panel button { display: block; width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; border: 0; background: transparent; color: var(--pi-text); }
  .action-menu-panel button:hover { background: var(--pi-selection-bg); }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: var(--pi-space-3); max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:hover, .workspace-label-link:focus { text-decoration: underline; }
  .workspace-detail-row .workspace-label { overflow: visible; white-space: normal; flex-wrap: wrap; }
  .workspace-detail-row .workspace-label-base, .workspace-detail-row .workspace-label-item, .workspace-detail-row .workspace-label-render { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; white-space: normal; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const chatStyles = css`
  ${SessionStateBadgeStyles}
  /* Mobile browsers paint a rectangular highlight on tap, which looks pasted-on
     over a round or rounded control. Suppressed in favour of the app's own
     pressed and focus styling; :focus-visible still shows keyboard focus, so
     nothing is lost for keyboard users. */
  button, [role="button"], a, summary, label, input, select { -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: inherit; }
  /* Motion is a preference, not a decoration: a user who asks for less of it
     gets none. Kept to a blanket rule because every animation here is
     ornamental — progress bars, pulses, fades — so there is no reduced variant
     worth designing separately. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { touch-action: manipulation; }
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
  .chat-wrap { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  /* Subagents strip: child sessions spawned by the parent conversation. The
     strip must read at one glance -- who is still working, who finished --
     and every row is a real button large enough to open with a thumb. */
  .subagents-strip { flex: 0 0 auto; display: grid; gap: var(--pi-space-3); box-sizing: border-box; padding: var(--pi-space-5) var(--pi-space-7) var(--pi-space-6); border-bottom: 1px solid var(--pi-border-muted); }
  .subagents-heading { min-width: 0; color: var(--pi-muted); font-size: var(--pi-text-2xs); font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .subagent-row { box-sizing: border-box; min-width: 0; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: var(--pi-space-4); min-height: 40px; padding: var(--pi-space-3) var(--pi-space-5); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; text-align: start; }
  .subagent-row:hover, .subagent-row:focus-visible { background: var(--pi-surface-hover); border-color: var(--pi-accent-border); }
  .subagent-row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .subagent-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--pi-muted); }
  .subagent-dot.working { background: var(--pi-accent); animation: pulse 1s ease-in-out infinite; }
  .subagent-dot.idle { background: var(--pi-success); }
  .subagent-dot.error { background: var(--pi-danger); }
  .subagent-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--pi-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: var(--pi-text-sm); color: var(--pi-text-bright); }
  .subagent-status { color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .subagent-row .subagent-status.working { color: var(--pi-accent); }
  .subagent-row .subagent-status.error { color: var(--pi-danger); }
  .subagent-chevron { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  @media (pointer: coarse) {
    .subagent-row { min-height: 44px; }
  }
  .session-warnings { flex: 0 1 auto; display: grid; gap: var(--pi-space-4); max-height: 50%; min-height: 0; overflow-y: auto; box-sizing: border-box; padding: var(--pi-space-5) var(--pi-space-7); border-bottom: 1px solid var(--pi-border-muted); }
  .session-warnings:only-child { flex: 1 1 auto; max-height: 100%; border-bottom: 0; }
  .session-warnings-controls { display: flex; justify-content: flex-end; }
  .session-warnings-collapse { display: inline-flex; align-items: center; gap: var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); padding: var(--pi-space-2) var(--pi-space-4); font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
  .session-warnings-collapse:hover, .session-warnings-collapse:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warnings-collapse:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .session-warnings-collapse-icon { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .session-warning { position: relative; display: grid; gap: var(--pi-space-2); box-sizing: border-box; padding: var(--pi-space-5) 34px var(--pi-space-5) var(--pi-space-6); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-lg); background: var(--pi-warning-surface); color: var(--pi-text); }
  .session-warning.error { border-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 12%, var(--pi-surface)); }
  .session-warning.info { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .session-warning-head { display: flex; align-items: center; gap: var(--pi-space-4); min-height: 16px; }
  .session-warning-icon { flex: 0 0 auto; width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-warning-body { min-width: 0; display: grid; gap: 3px; }
  .session-warning-message { margin: 0; overflow-wrap: anywhere; }
  .session-warning-path { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-xs); font-family: var(--pi-mono, ui-monospace, monospace); overflow-wrap: anywhere; }
  .session-warning-source { color: var(--pi-muted); font-size: var(--pi-text-2xs); text-transform: uppercase; letter-spacing: .04em; }
  .session-warning-dismiss { position: absolute; top: 6px; right: 6px; display: inline-grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); font: 15px/1 system-ui, sans-serif; cursor: pointer; }
  .session-warning-dismiss:hover, .session-warning-dismiss:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); background: var(--pi-bg-overlay); }
  .session-warning-dismiss:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .notification-tray { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; background: var(--pi-bg-overlay); }
  .notification-tray.collapsed { flex: 0 0 auto; }
  .notification-header { position: sticky; top: 0; z-index: 2; flex: 0 0 auto; min-width: 0; display: flex; flex-wrap: nowrap; align-items: center; justify-content: space-between; gap: var(--pi-space-4); box-sizing: border-box; min-height: 40px; padding: var(--pi-space-2) var(--pi-space-5); border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg-overlay); }
  .notification-tray.collapsed .notification-header { border-bottom: 0; }
  .notification-header:focus-visible { outline: 2px solid var(--pi-accent); outline-offset: -3px; }
  .notification-heading { min-width: 0; flex: 1 1 auto; overflow: hidden; color: var(--pi-text-bright); font-size: var(--pi-text-sm); text-overflow: ellipsis; white-space: nowrap; }
  .notification-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-1); }
  .notification-control, .notification-row-dismiss { box-sizing: border-box; min-height: 32px; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); cursor: pointer; }
  .notification-control { padding: 0 var(--pi-space-4); font: var(--pi-text-xs) var(--pi-font-ui); white-space: nowrap; }
  .notification-toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .notification-control:hover, .notification-control:focus-visible, .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .notification-control:focus-visible, .notification-row-dismiss:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .notification-control:disabled, .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
  .notification-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .notification-disclosure-icon.expanded { transform: rotate(90deg); }
  .notification-close-icon { width: 16px; height: 16px; }
  .notification-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 var(--pi-space-5) var(--pi-space-3); }
  .notification-list[hidden] { display: none; }
  .notification-overflow { margin: 0; padding: var(--pi-space-4) var(--pi-space-1); border-bottom: 1px solid var(--pi-border-muted); color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow-wrap: anywhere; }
  /* Severity is carried by the row itself, not only by a small coloured word:
     an error and a routine notice were otherwise structurally identical, so the
     tray had to be read to be triaged. The accent is a left border plus a very
     light wash, which stays legible in both themes without shouting. */
  .notification-row { position: relative; min-width: 0; display: grid; gap: var(--pi-space-2); box-sizing: border-box; margin: var(--pi-space-3) 0; padding: var(--pi-space-5) var(--pi-space-5) var(--pi-space-5) var(--pi-space-6); border: 1px solid var(--pi-border-muted); border-left: 3px solid var(--pi-border); border-radius: var(--pi-radius-md); color: var(--pi-text); }
  .notification-row.warning { border-left-color: var(--pi-warning); background: color-mix(in srgb, var(--pi-warning) 6%, transparent); }
  .notification-row.error { border-left-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 7%, transparent); }
  .notification-row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: calc(var(--pi-focus-ring-offset) * -1); }
  .notification-metadata { min-width: 0; display: flex; align-items: baseline; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-2xs); }
  .notification-severity { color: var(--pi-muted); font-size: inherit; font-weight: 600; }
  .notification-row.warning .notification-severity { color: var(--pi-warning); }
  .notification-row.error .notification-severity { color: var(--pi-danger); }
  .notification-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; text-align: start; unicode-bidi: plaintext; -webkit-user-select: text; user-select: text; }
  /* Only the first line needs to clear the buttons; later lines use the full
     width, so a long error does not wrap into a narrow column. */
  .notification-metadata { padding-right: 72px; }
  .notification-truncated { margin: 0; color: var(--pi-muted); font-size: var(--pi-text-2xs); overflow-wrap: anywhere; }
  /* Copy and dismiss sit together in one cluster rather than one floating over
     the text: the message wraps under them, so an absolute button either
     overlapped the text or forced padding that made every row look ragged. */
  .notification-row-actions { position: absolute; top: 4px; right: 4px; display: flex; gap: var(--pi-space-1); }
  .notification-row-dismiss, .notification-row-copy { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .notification-row-copy { min-height: 32px; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-base); cursor: pointer; }
  .notification-row-copy:hover, .notification-row-copy:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .notification-row-copy:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .visually-hidden { position: absolute !important; width: 1px !important; height: 1px !important; padding: 0 !important; margin: -1px !important; overflow: hidden !important; clip: rect(0 0 0 0) !important; clip-path: inset(50%) !important; white-space: nowrap !important; border: 0 !important; }
  .notification-live span { display: block; }
  @media (pointer: coarse) {
    .notification-control, .notification-row-dismiss, .notification-row-copy { min-height: 34px; }
    .notification-toggle, .notification-row-dismiss, .notification-row-copy { width: 34px; height: 34px; }
    .notification-row { padding-right: 40px; }
  }
  @media (max-width: 520px) {
    .notification-header { gap: var(--pi-space-2); padding-inline: 8px; }
    .notification-list { padding-inline: 8px; }
  }
  .chat { --pi-chat-sticky-top: -26px; height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: 26px var(--pi-space-7) 64px; box-sizing: border-box; }
  .scroll-marker { display: block; height: 0; overflow: hidden; pointer-events: none; }
  /* Pinned above the composer, not inside the transcript: a queued message is
     pending intent, so it must stay reachable while the agent keeps writing.
     max-height keeps a long queue from swallowing the conversation. */
  .subagent-duration { flex: 0 0 auto; color: var(--pi-muted); font-variant-numeric: tabular-nums; font-size: var(--pi-text-xs); }
  .subagent-detail { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  .subagent-row[disabled] { cursor: default; opacity: .8; }
  .subagent-dot.running { background: var(--pi-success); }
  .subagent-dot.failed { background: var(--pi-danger); }
  .subagent-status.running { color: var(--pi-success); }
  .subagent-status.failed { color: var(--pi-danger); }
  .queued-dock { position: absolute; left: 16px; right: 16px; bottom: 56px; z-index: 21; display: flex; flex-direction: column; gap: var(--pi-space-4); max-height: 40%; overflow-y: auto; }
  .queued-recall-button { flex: 0 0 auto; align-self: flex-start; border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: transparent; color: var(--pi-warning); padding: 2px var(--pi-space-4); font-size: var(--pi-text-xs); cursor: pointer; }
  .queued-recall-button:hover { background: var(--pi-warning-surface); }
  .activity-dock { position: absolute; left: 16px; right: 16px; bottom: 12px; z-index: 20; display: flex; align-items: center; gap: var(--pi-space-4); min-width: 0; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-bg-overlay); color: var(--pi-muted); padding: var(--pi-space-4) var(--pi-space-6); font-size: var(--pi-text-sm); pointer-events: none; box-shadow: 0 8px 28px var(--pi-shadow); backdrop-filter: blur(6px); }
  .activity-dock.active { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-bg-overlay); }
  .activity-dock.sending { border-color: var(--pi-warning-border); color: var(--pi-warning); background: var(--pi-warning-surface); }
  .activity-dock.asking { border-color: var(--pi-warning-border); color: var(--pi-warning); background: var(--pi-warning-bg-overlay); }
  .activity-dock.error { border-color: var(--pi-danger-border); color: var(--pi-danger); background: var(--pi-danger-bg-overlay); }
  .activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity-dock.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .activity-dock .state-dot { background: currentColor; }
  .activity-dock.working .state-dot { opacity: 1; }
  .msg { max-width: 100%; min-width: 0; box-sizing: border-box; margin: 0 0 var(--pi-space-7); padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); overflow: visible; }
  .msg.assistant, .msg.tool-image-output { background: var(--pi-surface); }
  .msg.user { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  .msg.tool { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
  .msg.tool-execution-shell, .msg.ask-user-record-shell { padding: 0; border: 0; background: transparent; color: var(--pi-text); }
  .msg.ask-user-record-shell ask-user-card { margin: 0 auto; }
  .msg.system { color: var(--pi-danger); }
  .msg.bash { border-color: var(--pi-success); background: var(--pi-success-bg); }
  .msg.skill { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .msg.event-group { padding: 0; border-color: var(--pi-border); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live { border-color: var(--pi-success-border); background: var(--pi-success-bg); }
  .msg.event-group > summary { position: sticky; top: -26px; z-index: 5; display: flex; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-6); border-radius: var(--pi-radius-md) var(--pi-radius-md) 0 0; border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live > summary { border-bottom-color: var(--pi-success-border); background: var(--pi-success-bg); color: var(--pi-success); }
  .msg.event-group > summary .label { margin: 0; }
  .group-body { padding: 0 var(--pi-space-6) var(--pi-space-6); }
  .chat-image { display: block; max-width: 100%; max-height: 320px; margin: var(--pi-space-4) 0 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); object-fit: contain; cursor: zoom-in; }
  .chat-image:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent, var(--pi-success-border)); outline-offset: var(--pi-focus-ring-offset); }
  dialog.image-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.image-zoom[open] { display: flex; }
  dialog.image-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .image-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; cursor: zoom-out; }
  .image-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 28px; height: 28px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); cursor: pointer; }
  .image-zoom-close:hover, .image-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  .image-zoom-close:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: var(--pi-space-5) 0; border-top: 1px solid var(--pi-border-muted); color: var(--pi-text); overflow: visible; }
  .group-msg.tool { color: var(--pi-warning); }
  .group-msg.tool-execution-shell { color: var(--pi-text); }
  .group-msg.system { color: var(--pi-danger); }
  .group-msg.bash { color: var(--pi-success); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 0 var(--pi-space-7); color: var(--pi-muted); font-size: var(--pi-text-xs); text-align: center; }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text-secondary); padding: var(--pi-space-3) var(--pi-space-6); font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
  .history-load-button:hover, .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  .queued-messages { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: var(--pi-space-4); margin: 0 0 var(--pi-space-7); padding: var(--pi-space-6); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-lg); background: var(--pi-warning-surface); color: var(--pi-text); overflow: hidden; }
  .queued-header { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: var(--pi-space-5); }
  .queued-heading { min-width: 0; flex: 1 1 180px; display: grid; gap: var(--pi-space-1); }
  .queued-heading strong { color: var(--pi-warning); }
  .queued-heading small { color: var(--pi-muted); }
  .queued-clear-button { flex: 0 0 auto; border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-warning); padding: var(--pi-space-3) var(--pi-space-5); font: var(--pi-text-xs) var(--pi-font-ui); white-space: nowrap; cursor: pointer; }
  .queued-clear-button:hover, .queued-clear-button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
  .queued-message { display: grid; gap: var(--pi-space-2); padding-top: var(--pi-space-4); border-top: 1px solid var(--pi-border); }
  .queued-message:first-of-type { padding-top: 0; border-top: 0; }
  .queued-kind { color: var(--pi-muted); font-size: var(--pi-text-xs); text-transform: uppercase; }
  .queued-dialogs { margin: -8px 0 var(--pi-space-7); padding: 0 var(--pi-space-2); color: var(--pi-muted); font-size: var(--pi-text-xs); text-align: center; }
  /* Delivery mark: bottom-right of the sender's own bubble, quiet enough to
     ignore while reading and specific enough to answer "did that send?". */
  .delivery-mark { display: flex; align-items: center; justify-content: flex-end; gap: var(--pi-space-3); margin: var(--pi-space-3) -2px -4px 0; color: var(--pi-dim); font: var(--pi-text-2xs) var(--pi-font-ui); }
  .delivery-mark .delivery-glyph { font-size: var(--pi-text-xs); letter-spacing: -1px; line-height: 1; }
  .delivery-mark.pending { color: var(--pi-dim); }
  .delivery-mark.pending .delivery-glyph { animation: pulse 1.4s ease-in-out infinite; }
  .delivery-mark.received { color: var(--pi-muted); }
  .delivery-mark.delivered { color: var(--pi-success); }
  .delivery-mark.failed { color: var(--pi-danger); font-weight: 600; }
  .session-activity { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: var(--pi-space-2); margin: 0 0 var(--pi-space-7); padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); overflow: hidden; }
  .session-activity.compacting { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .session-activity strong { color: var(--pi-purple); }
  .session-activity span, .session-activity small { color: var(--pi-muted); }
  .history-boundary small { color: var(--pi-dim); }
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-5); min-height: 22px; margin-bottom: var(--pi-space-4); }
  .msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -12px -12px var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-5) var(--pi-space-3); border-radius: var(--pi-radius-md) var(--pi-radius-md) 0 0; border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-surface); box-shadow: 0 8px 18px var(--pi-shadow-soft); }
  .msg.user > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-accent-border) 35%, transparent); background: var(--pi-selection-bg); }
  .msg.assistant > .msg-header .label, .msg.tool-image-output > .msg-header .label { color: var(--pi-text-secondary); }
  .msg.user > .msg-header .label { color: var(--pi-accent); }
  .msg.tool > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); background: var(--pi-warning-surface); }
  .msg.bash > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-success) 35%, transparent); background: var(--pi-success-bg); }
  .msg.skill > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-purple-border) 35%, transparent); background: var(--pi-purple-surface); }
  .group-msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -10px 0 var(--pi-space-4); padding: var(--pi-space-4) 0 var(--pi-space-3); border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-bg); }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--pi-space-4); }
  .msg-actions { flex: 0 0 auto; display: inline-flex; gap: var(--pi-space-3); opacity: 0; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
  .msg-action { display: inline-grid; place-items: center; width: 32px; height: 32px; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: var(--pi-text-base) var(--pi-font-ui); line-height: 1; cursor: pointer; }
  .msg-action:hover, .msg-action:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  .msg:hover > .msg-header .msg-actions, .msg:focus-within > .msg-header .msg-actions, .group-msg:hover > .msg-header .msg-actions, .group-msg:focus-within > .msg-header .msg-actions { opacity: 1; }
  .label { display: block; color: var(--pi-muted); font-size: var(--pi-text-xs); text-transform: uppercase; }
  .msg-header .label { margin: 0; }
  .msg-meta { min-width: 0; opacity: .28; border: 0; background: transparent; color: var(--pi-dim); padding: 0; font: var(--pi-text-2xs) var(--pi-font-ui); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity var(--pi-motion-fast) var(--pi-ease); cursor: pointer; user-select: text; -webkit-user-select: text; }
  .msg:hover > .msg-header .msg-meta, .msg:focus-within > .msg-header .msg-meta, .group-msg:hover > .msg-header .msg-meta, .group-msg:focus-within > .msg-header .msg-meta, .msg-meta:focus, .msg-meta.expanded { opacity: 1; }
  .msg-meta.expanded { flex: 1 1 auto; max-width: 100%; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; }
  .msg-meta:focus { outline: 1px solid var(--pi-border); outline-offset: 3px; border-radius: var(--pi-radius-xs); }
  @media (hover: none) {
    .msg-actions { opacity: 1; }
    .msg-meta { opacity: .75; max-width: 26px; }
    .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 22px; place-items: center; font-size: 0; text-overflow: clip; }
    .msg-meta::before { content: "ⓘ"; font-size: var(--pi-text-sm); }
    .msg-meta.expanded { opacity: 1; max-width: 100%; }
    .msg-meta.expanded::before { content: ""; }
  }
  formatted-text.part { display: block; }
  formatted-text.part, .queued-message formatted-text { text-align: start; unicode-bidi: plaintext; }
  .part { max-width: 100%; min-width: 0; box-sizing: border-box; overflow: visible; }
  .part + .part { margin-top: var(--pi-space-5); }
  .tool-line { color: var(--pi-warning); }
  .summary { color: var(--pi-muted); margin-left: var(--pi-space-3); }
  .part:is(details) { border-top: 1px solid var(--pi-border); padding-top: var(--pi-space-4); }
  .part > formatted-text { display: block; max-width: 100%; min-width: 0; overflow: visible; }
  .skill-invocation, .skill-read { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); padding: var(--pi-space-4) var(--pi-space-5); }
  .skill-invocation > summary, .skill-read > strong { color: var(--pi-purple); }
  .skill-invocation > small, .skill-read > small { display: block; margin: var(--pi-space-3) 0 0; color: var(--pi-muted); }
  summary { cursor: pointer; color: var(--pi-muted); }
  pre { margin: var(--pi-space-3) 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .shell-output { color: var(--pi-text); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.45; direction: ltr; text-align: left; unicode-bidi: isolate; }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const formattedTextStyles = css`
  :host { display: block; }
  .formatted { white-space: normal; overflow-wrap: anywhere; line-height: 1.45; text-align: start; unicode-bidi: plaintext; }
  p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper { margin: 0 0 var(--pi-space-5); }
  :is(p, ul, ol, pre, blockquote, .table-scroll, .code-block-wrapper):last-child { margin-bottom: 0; }
  ul, ol { padding-left: var(--pi-space-9); }
  li + li { margin-top: 3px; }
  code { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-xs); background: var(--pi-bg); padding: 1px var(--pi-space-2); font: 13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; direction: ltr; text-align: left; unicode-bidi: isolate; }
  .code-block-wrapper { position: relative; }
  .code-block-wrapper pre { margin: 0; padding-right: 40px; }
  pre { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-bg); padding: var(--pi-space-5); overflow-x: auto; overflow-y: hidden; direction: ltr; text-align: left; unicode-bidi: isolate; }
  pre code { border: 0; padding: 0; background: transparent; }
  .code-copy-button { position: absolute; top: 6px; right: 6px; z-index: 1; display: inline-grid; place-items: center; width: 24px; height: 24px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: var(--pi-text-base) var(--pi-font-ui); line-height: 1; cursor: pointer; }
  .code-copy-button:hover, .code-copy-button:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  blockquote { border-left: 3px solid var(--pi-border); padding-left: var(--pi-space-5); color: var(--pi-muted); }
  a { color: var(--pi-accent); }
  h1, h2, h3, h4 { margin: var(--pi-space-7) 0 var(--pi-space-4); line-height: 1.2; }
  h1:first-child, h2:first-child, h3:first-child, h4:first-child { margin-top: 0; }
  h1 { font-size: var(--pi-text-xl); }
  h2 { font-size: var(--pi-text-lg); }
  h3 { font-size: var(--pi-text-md); }
  h4 { font-size: var(--pi-text-base); }
  .table-scroll { max-width: 100%; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
  .table-scroll:focus-visible { outline: 1px solid var(--pi-accent); outline-offset: 2px; }
  table { border-collapse: collapse; width: max-content; min-width: 100%; max-width: none; }
  th, td { border: 1px solid var(--pi-border); padding: var(--pi-space-2) var(--pi-space-4); max-width: 48ch; overflow-wrap: anywhere; }
  th { background: var(--pi-surface); }
`;

export const statusBarStyles = css`
  :host { display: block; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-ui); }
  .bar { display: flex; justify-content: flex-end; gap: var(--pi-space-6); align-items: center; min-width: 0; padding: var(--pi-space-4) var(--pi-space-6); border-top: 1px solid var(--pi-border); background: var(--pi-bg); white-space: nowrap; overflow: hidden; }
  span { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .warning-toggle { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-2); margin-right: auto; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; line-height: 1; white-space: nowrap; cursor: pointer; }
  .warning-toggle:focus-visible { outline: 1px solid currentColor; outline-offset: 2px; }
  .warning-toggle-icon { flex: 0 0 auto; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .activity { display: inline-flex; align-items: center; gap: var(--pi-space-3); color: var(--pi-muted); }
  .activity.active { color: var(--pi-success); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .muted { color: var(--pi-dim); }
  @keyframes pulse { 0%, 100% { transform: scale(.75); opacity: .55; } 50% { transform: scale(1.2); opacity: 1; } }
`;

export const autocompleteStyles = css`
  :host { display: block; }
  .menu { position: absolute; left: 0; right: 0; bottom: calc(100% + 6px); z-index: 10; max-height: 260px; overflow: auto; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); box-shadow: 0 10px 30px var(--pi-shadow); }
  button { display: grid; grid-template-columns: minmax(120px, 1fr) auto; gap: var(--pi-space-2) var(--pi-space-5); width: 100%; border: 0; border-bottom: 1px solid var(--pi-border); border-radius: 0; background: transparent; color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); text-align: left; cursor: pointer; }
  button:last-child { border-bottom: 0; }
  button.selected, button:hover { background: var(--pi-selection-bg); }
  span { color: var(--pi-muted); font-size: var(--pi-text-xs); }
  small { grid-column: 1 / -1; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;

export const promptEditorStyles = css`
  /* Mobile browsers paint a rectangular highlight on tap, which looks pasted-on
     over a round or rounded control. Suppressed in favour of the app's own
     pressed and focus styling; :focus-visible still shows keyboard focus, so
     nothing is lost for keyboard users. */
  button, [role="button"], a, summary, label, input, select { -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: inherit; }
  /* Motion is a preference, not a decoration: a user who asks for less of it
     gets none. Kept to a blanket rule because every animation here is
     ornamental — progress bars, pulses, fades — so there is no reduced variant
     worth designing separately. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { touch-action: manipulation; }
  :host { position: relative; z-index: 5; display: block; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
  footer { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--pi-space-4); padding: var(--pi-space-6); border-top: 1px solid var(--pi-border); }
  footer.shell-mode { border-top-color: var(--pi-success); background: var(--pi-success-bg); }
  .editor-wrap { position: relative; min-width: 0; }
  .actions { display: flex; gap: var(--pi-space-4); align-items: center; justify-content: flex-end; flex-wrap: nowrap; white-space: nowrap; }
  .compact-status { display: flex; min-width: 0; align-items: center; gap: var(--pi-space-3); color: var(--pi-muted); font-size: var(--pi-text-xs); flex: 1 1 0; }
  .compact-status > button { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .select-model { max-width: min(42vw, 320px); min-height: 40px; display: inline-flex; align-items: center; box-sizing: border-box; }
  .icon-button { flex: 0 0 auto; display: inline-grid; place-items: center; width: 36px; height: 36px; box-sizing: border-box; padding: 0; }
  .icon-button .prompt-action-icon, .icon-button .prompt-thinking-gauge { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .icon-button .prompt-action-icon-filled { fill: currentColor; stroke: none; }
  .send-button:not(:disabled) { color: var(--pi-accent, var(--pi-text)); }
  .stop-button:not(:disabled) { color: var(--pi-danger); }
  .select-thinking .prompt-thinking-gauge .gauge-bar { fill: currentColor; stroke: none; opacity: .28; }
  .select-thinking .prompt-thinking-gauge .gauge-bar-active { opacity: 1; }
  .editor-attach { position: absolute; right: 8px; bottom: 8px; z-index: 2; width: 30px; height: 30px; }
  /* Sits beside the attach control, inside the editor box. */
  .editor-dictate { position: absolute; right: 44px; bottom: 8px; z-index: 2; width: 30px; height: 30px; font-size: var(--pi-text-2xs); }
  .editor-dictate.listening { color: var(--pi-danger); border-color: var(--pi-danger); }
  .editor-attach .prompt-action-icon { width: 16px; height: 16px; }
  textarea, .markdown-editor .cm-editor { box-sizing: border-box; width: 100%; min-height: 54px; max-height: 220px; resize: none; overflow: hidden; border-radius: var(--pi-radius-md); border: 1px solid var(--pi-border); background: var(--pi-bg); color: var(--pi-text); font: var(--pi-control-font-size, 16px)/1.4 var(--pi-control-font-family, system-ui, sans-serif); }
  textarea { overflow-y: auto; padding: var(--pi-space-4); }
  .markdown-editor .cm-scroller { max-height: 220px; overflow-y: auto; font-family: var(--pi-control-font-family, system-ui, sans-serif); line-height: 1.4; }
  .markdown-editor .cm-content { min-height: 38px; padding: var(--pi-space-4) 44px var(--pi-space-4) var(--pi-space-4); caret-color: var(--pi-text); text-align: start; unicode-bidi: plaintext; --pi-composer-pad: 8px; }
  .markdown-editor .cm-cursor, .markdown-editor .cm-dropCursor { border-left-width: 2px; }
  /* The caret should sit on the line the text will occupy: 1.4 * font-size is
     the line's height, and centering a caret of that height in the line box
     keeps it visually aligned with the surrounding text instead of hanging
     lower -- the old 1.25em + margin approach drifted as the font size changed. */
  .markdown-editor .cm-cursor { height: 1.4em !important; }
  /* An empty document still has one line, and a min-height on the content
     stretches that single line box to fill it. The caret is sized from the line
     box, so before the first keystroke it rendered at the full height of the
     editor and then snapped down once text arrived. Pinning the line box to the
     text's own line-height keeps the caret the same size whether or not
     anything has been typed; the editor keeps its minimum size through the
     container, not by inflating the line. */
  .markdown-editor .cm-line { padding: 0; min-height: calc(var(--pi-control-font-size, 16px) * 1.4); line-height: 1.4; unicode-bidi: plaintext; }
  /* The placeholder renders inside the first line, so a hint long enough to
     wrap made the empty line as tall as the wrapped text. The caret is sized
     from that line box, which is why it towered over the input until the first
     keystroke removed the placeholder. Taking it out of flow lets the empty
     line keep the height of a single line of text, and the caret with it. */
  /* Out of flow so a wrapped hint cannot inflate the empty line (and with it
     the caret), but still anchored to the content's text area: the content has
     8px of left padding, and a placeholder spanning the box edge paints the
     hint 8px left of where the first keystroke will land -- the caret visibly
     overlapping the first character. */
  .markdown-editor .cm-placeholder { position: absolute; inset-block: 0; left: 8px; right: 44px; display: flex; align-items: center; pointer-events: none; }
  .markdown-editor .cm-placeholder { color: var(--pi-dim); }
  /* CodeMirror suppresses its own outline, so the focus ring belongs on the
     bordered box the user actually sees. Without this the composer was the one
     control in the app that gave no sign of being focused. */
  .markdown-editor .cm-focused { outline: none; }
  .markdown-editor:focus-within .cm-editor { border-color: var(--pi-accent); box-shadow: 0 0 0 1px var(--pi-accent-ring, var(--pi-accent)); }
  /* drawSelection() renders the caret and selection itself, and CodeMirror's
     base colors for them assume a light editor (black caret, pale selection).
     Re-theme them so they stay readable in every pi-web theme. The focused
     selection rule must outspecify CodeMirror's base rule for the focused
     selection background. */
  .markdown-editor .cm-cursor { border-left-color: var(--pi-text); }
  .markdown-editor .cm-editor .cm-selectionBackground { background: color-mix(in srgb, var(--pi-text) 18%, transparent); }
  .markdown-editor .cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: color-mix(in srgb, var(--pi-accent) 32%, transparent); }  .shell-mode textarea, .shell-mode .markdown-editor .cm-editor { border-color: var(--pi-success); box-shadow: 0 0 0 1px var(--pi-success-ring); }
  .mode-hint { position: absolute; right: 46px; bottom: 8px; max-width: calc(100% - 54px); border: 1px solid var(--pi-success-border); border-radius: var(--pi-radius-pill); background: var(--pi-success-surface); color: var(--pi-success); padding: var(--pi-space-1) var(--pi-space-4); font-size: var(--pi-text-xs); pointer-events: none; }
  /* Attachments live above the text box, so pasted images/files are visible
     before the user starts editing the message body and never get hidden below
     the keyboard/action row on mobile. */
  .attachments { display: flex; flex-wrap: wrap; align-items: center; gap: var(--pi-space-4); margin: 0; padding: 0 0 var(--pi-space-1); }
  .attachment-chip { position: relative; width: 56px; height: 56px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); overflow: hidden; background: var(--pi-bg); }
  .attachment-chip img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .attachment-chip-file { display: grid; place-items: center; }
  .attachment-file-preview { display: grid; place-items: center; width: 34px; height: 26px; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-xs); background: var(--pi-surface); color: var(--pi-muted); font: 700 10px/1 system-ui, sans-serif; letter-spacing: .03em; }
  .attachment-file-name { position: absolute; right: 4px; bottom: 3px; left: 4px; overflow: hidden; color: var(--pi-muted); font-size: 10px; line-height: 1.2; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
  .attachment-remove { position: absolute; top: 1px; right: 1px; width: 18px; height: 18px; padding: 0; line-height: 16px; border-radius: 50%; border: 1px solid var(--pi-border); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-sm); cursor: pointer; }
  .attachment-delivery select { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); font: var(--pi-control-font-size, 16px) var(--pi-control-font-family, system-ui, sans-serif); }
  .attachment-error { flex-basis: 100%; color: var(--pi-danger); font-size: var(--pi-text-xs); }
  button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  button:disabled, textarea:disabled, .markdown-editor-disabled .cm-editor { opacity: .5; cursor: not-allowed; }
      footer { gap: var(--pi-space-4); padding: var(--pi-space-4); }
    .actions { gap: var(--pi-space-3); }
    .compact-status { flex: 1 1 220px; gap: var(--pi-space-2); }
    .select-model { max-width: min(58vw, 260px); }
    button { padding: var(--pi-space-3) var(--pi-space-4); }
  }
  @media (max-width: 430px) {
    .compact-status { flex-basis: 170px; font-size: var(--pi-text-2xs); }
    .select-model { max-width: 48vw; }
    button { padding: var(--pi-space-3) var(--pi-space-4); }
    /* Narrow screens are phones: the touch targets get *bigger*, not smaller,
       and the caret keeps the line height it has on wide screens. */
    .icon-button { width: 40px; height: 40px; }
    .markdown-editor .cm-cursor { height: 1.4em !important; }
  }

  /* Hold the whole list layout still while the user is selecting rows: the
     checkbox and toolbar must not make rows jump between drags. */
  @media (max-width: 760px) {
    section { padding: var(--pi-space-4); }
    h2 { margin: 0 0 var(--pi-space-3); }
    .action-row { margin: var(--pi-space-2) 0; }
    .action-main { padding: 6px 20px 6px calc(8px + var(--depth, 0) * 14px); }
    .list-search-input { height: 30px; font-size: var(--pi-text-sm); padding: 0 var(--pi-space-4); }
    .list-search-clear { width: 30px; height: 30px; }
    .list-body.tiles { gap: var(--pi-space-3); grid-template-columns: 1fr; }
    .list-body.tiles .action-main { min-height: 48px; padding: var(--pi-space-4) 28px var(--pi-space-4) var(--pi-space-4); }
  }`;