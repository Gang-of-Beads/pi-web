import { css, svg, type TemplateResult } from "lit";
import type { ChatRole } from "../chatRole";
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
  role: ChatRole;
  parts: ChatPart[];
  source?: "compaction" | "branch_summary";
  meta?: {
    timestamp?: string;
    /** The provider's id for the reply this line belongs to; see messageIdentity.ts. */
    responseId?: string;
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
  kind: "command" | "file" | "model";
  replaceFrom: number;
  replaceTo: number;
  insertText: string;
  detail: string;
  description?: string;
  cursorOffset?: number;
}

export const workspacePanelStyles = css`
  /* Motion is decoration here: scroll shadows, hover fades, pulsing dots. A
     reader who asked the system for less motion gets none of it. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }

  /* A pending image attachment opens full-size in its own dialog: the native
     top layer covers the page, Esc and a backdrop click close it, and the
     controls are reachable by keyboard like every other control in the app. */
  dialog.attachment-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.attachment-zoom[open] { display: flex; }
  dialog.attachment-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .attachment-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; }
  .attachment-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); cursor: pointer; }
  .attachment-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  @media (hover: hover) { .attachment-zoom-close:hover { color: var(--pi-text-bright); border-color: var(--pi-accent); } }
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
  button { font: var(--pi-text-xs) var(--pi-font-ui); display: inline-flex; align-items: center; gap: var(--pi-space-3); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-3) var(--pi-space-4); cursor: pointer; }
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
  .workspace-label-link:focus { text-decoration: underline; }
  @media (hover: hover) { .workspace-label-link:hover { text-decoration: underline; } }
  .toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); }
  .toolbar button { margin-left: auto; }
  .stale { border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); color: var(--pi-warning); padding: 1px var(--pi-space-3); font-size: var(--pi-text-xs); }
  .split { flex: 1 1 auto; min-height: 0; display: grid; grid-template-rows: minmax(160px, 34%) minmax(0, 1fr); }
  /* With nothing selected there is no second pane to show, so the list takes
     the panel rather than sitting above an empty one. */
  .split.list-only { grid-template-rows: minmax(0, 1fr) 0; }
  .split.list-only > :nth-child(2) { display: none; }
  .list { min-height: 0; overflow: auto; border-bottom: 1px solid var(--pi-border); padding: var(--pi-space-3); }
  .row { display: grid; grid-template-columns: 18px minmax(0, 1fr); gap: var(--pi-space-2); width: 100%; border: 0; border-radius: var(--pi-radius-sm); background: transparent; text-align: left; padding: 4px 6px 4px calc(6px + var(--depth, 0) * 14px); }
  .row.selected { background: var(--pi-selection-bg); }
  @media (hover: hover) { .row:hover { background: var(--pi-selection-bg); } }
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
  button, [role="button"], a, summary, label, input, select { font: var(--pi-text-xs) var(--pi-font-ui); -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: inherit; }
  /* Motion is a preference, not a decoration: a user who asks for less of it
     gets none. Kept to a blanket rule because every animation here is
     ornamental — progress bars, pulses, fades — so there is no reduced variant
     worth designing separately. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
  }

  /* A pending image attachment opens full-size in its own dialog: the native
     top layer covers the page, Esc and a backdrop click close it, and the
     controls are reachable by keyboard like every other control in the app. */
  dialog.attachment-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.attachment-zoom[open] { display: flex; }
  dialog.attachment-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .attachment-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; }
  .attachment-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: 44px; height: 44px; padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); cursor: pointer; }
  .attachment-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  @media (hover: hover) { .attachment-zoom-close:hover { color: var(--pi-text-bright); border-color: var(--pi-accent); } }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { font: var(--pi-text-xs) var(--pi-font-ui); touch-action: manipulation; }
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
  /* The create control for a section, carried by its heading rather than by a
     bar of its own: a stacked bar cost a fifth of a phone screen before any
     content, and the heading was already a flex row with a free trailing edge.
     Sized to the tap-target floor even though the glyph is small. */
  .section-add-label { font-size: var(--pi-text-xs); white-space: nowrap; }
  .section-add { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; gap: var(--pi-space-2); min-width: 32px; min-height: 32px; padding: 0 var(--pi-space-5); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); font-size: var(--pi-text-lg); line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  .section-add:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: -2px; }
  @media (hover: hover) { .section-add:hover { border-color: var(--pi-accent); } }
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
  .list-body.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); grid-auto-rows: min-content; gap: var(--pi-space-4); align-content: start; padding: var(--pi-space-2) var(--pi-space-1); }
  .list-body.tiles .action-row { grid-template-columns: minmax(0, 1fr); margin: 0; align-self: start; }
  .list-body.tiles .action-main { border-radius: var(--pi-radius-lg); padding: var(--pi-space-5) 30px var(--pi-space-5) var(--pi-space-5); min-height: 56px; align-content: center; }
  .list-body.tiles .action-menu { position: absolute; top: 6px; right: 6px; align-self: auto; }
  /* One nowrap line cut most tile names to the same prefix; two wrapped lines
     reach the tail that tells worktree-agent-a0… tiles apart. break-all because
     branch names have no spaces to wrap at. */
  .list-body.tiles .workspace-primary-label { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; word-break: break-all; }
  /* In a row the toggle drops its left border on purpose: the primary region
     sits against it and draws the divider. A tile floats it in the corner with
     nothing on its left, so the same rule left the button open on one side.
     Give it back a full border and its own radius. */
  .list-body.tiles .action-menu-toggle { height: 32px; min-width: 32px; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); }
  /* Touch needs a bigger target than a mouse; 32px is the smallest a finger
     hits reliably next to a tile's own tap area. */
  @media (pointer: coarse) {
    .list-body.tiles { --pi-tile-menu-size: 36px; --pi-tile-menu-inset: 4px; }
    .list-body.tiles .action-menu-toggle { height: 36px; min-width: 36px; }
    .list-body.tiles .action-menu { top: 4px; right: 4px; }
  }
  /* Clear of the actions button rather than a guess at its width: it is 32px
     wide, 36px on a touch screen, and the dot was pinned at 32px from the same
     edge, which put most of it on the button. */
  .list-body.tiles { --pi-tile-menu-size: 32px; --pi-tile-menu-inset: 6px; }
  .list-body.tiles .action-activity { top: 7px; right: calc(var(--pi-tile-menu-inset) + var(--pi-tile-menu-size) + var(--pi-space-3)); }
  button { font: var(--pi-text-xs) var(--pi-font-ui); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-5); cursor: pointer; }
  section > button { display: block; width: 100%; text-align: left; margin: var(--pi-space-3) 0; }
  .subheading { margin-top: var(--pi-space-7); }
  .section-toggle { display: flex; flex: 1 1 auto; min-width: 0; align-items: center; justify-content: space-between; gap: var(--pi-space-4); width: 100%; border: 0; background: transparent; color: inherit; padding: 0; font: inherit; text-align: left; text-transform: inherit; }
  .section-toggle span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .section-title { display: grid; gap: var(--pi-space-1); min-width: 0; }
  .section-toggle .section-selected { display: block; color: var(--pi-text); font-size: var(--pi-text-xs); font-weight: 600; line-height: 1.25; text-transform: none; }
  .section-toggle .section-count { flex: 0 0 auto; display: inline; color: var(--pi-muted); font-size: inherit; }
  .section-toggle small { display: inline; color: inherit; font-size: inherit; }
  /* One surface per row. The body and the overflow menu used to be two
     outlined boxes butted together, so their shared edge stacked into a hard
     rule and the row read as a table cell. The border and the radius belong to
     the row; what sits inside it is transparent. */
  .action-row { position: relative; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: var(--pi-space-3) 0; cursor: pointer; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); overflow: hidden; }
  .action-row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); border-radius: var(--pi-radius-md); }
  .action-row.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  .action-row.archived .action-main { color: var(--pi-muted); }
  /* Written to work whether the primary region is a div or a real <button>:
     the font and cursor resets are inert on a div and stop a button from
     inheriting the UA's centred, small-font control styling. */
  .action-main { position: relative; box-sizing: border-box; min-width: 0; width: 100%; display: block; border: 0; background: transparent; color: var(--pi-text); padding: var(--pi-space-4) var(--pi-space-9) var(--pi-space-4) calc(var(--pi-space-5) + var(--depth, 0) * var(--pi-space-7)); font: inherit; text-align: left; cursor: pointer; }
  button.action-main:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: calc(var(--pi-focus-ring-offset) * -1); }
  .action-name { display: -webkit-box; max-height: 2.5em; overflow: hidden; overflow-wrap: anywhere; line-height: 1.25; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
  @media (hover: hover) { .action-row:not(.selected):hover { background: var(--pi-surface-hover); } }
  .workspace-row .action-main { border-radius: var(--pi-radius-md) 0 0 var(--pi-radius-md); }
  .workspace-primary { min-width: 0; display: flex; align-items: baseline; gap: var(--pi-space-3); }
  .workspace-primary-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-status { flex: 0 0 auto; color: var(--pi-warning); font-size: var(--pi-text-xs); }
  .workspace-secondary { margin-top: 3px; }
  .workspace-menu-panel { width: max-content; min-width: min(120px, calc(100vw - 16px)); padding: var(--pi-space-4); }
  .workspace-menu-actions { margin: 0 0 var(--pi-space-4); padding-bottom: var(--pi-space-4); border-bottom: 1px solid var(--pi-border-muted); }
  .workspace-menu-actions button.danger { color: var(--pi-danger); }
  .workspace-menu-actions button.danger:focus { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); }
  @media (hover: hover) { .workspace-menu-actions button.danger:hover { background: color-mix(in srgb, var(--pi-danger) 14%, transparent); } }
  .workspace-menu-details { display: grid; gap: var(--pi-space-3); margin: 0; }
  .workspace-detail-row { display: grid; grid-template-columns: minmax(58px, max-content) minmax(0, 1fr); gap: var(--pi-space-4); align-items: baseline; }
  .workspace-detail-row dt { color: var(--pi-muted); font-size: var(--pi-text-xs); white-space: normal; }
  .workspace-detail-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; white-space: normal; }
  .action-menu-panel .detail-copy { box-sizing: border-box; display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: var(--pi-space-3); padding: 0; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); font-size: var(--pi-text-2xs); line-height: 1; cursor: pointer; vertical-align: middle; }
  .action-menu-panel .detail-copy:focus { color: var(--pi-text); border-color: var(--pi-accent); background: var(--pi-surface-hover); }
  @media (hover: hover) { .action-menu-panel .detail-copy:hover { color: var(--pi-text); border-color: var(--pi-accent); background: var(--pi-surface-hover); } }
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
  .action-row { border-left: var(--pi-rail-width, 3px) solid transparent; transition: border-left-color var(--pi-motion-fast) var(--pi-ease); }
  .action-row:has(.activity-indicator.session) { border-left-color: var(--pi-success); }
  .action-row:has(.activity-indicator.terminal) { border-left-color: var(--pi-accent); }
  .action-row:has(.activity-indicator.sending) { border-left-color: var(--pi-warning); }
  .action-row:has(.activity-indicator.unread) .action-main,
  .action-row:has(.unread-ring) { border-left-color: var(--pi-accent); }
  /* Rows report unread as their own class rather than a child indicator, so
     the rail reads it there too; the two paths cover every list. */
  .action-row.unread { border-left-color: var(--pi-accent); }
  .action-row.archived { border-left-color: var(--pi-border); }
  .action-row.selected { border-left-color: var(--pi-accent); }
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
  .action-menu-toggle { display: grid; place-items: center; height: 100%; min-width: 32px; padding: 0; color: var(--pi-muted); border: 0; border-radius: 0; background: transparent; }
  @media (hover: hover) { .action-menu-toggle:hover { color: var(--pi-text); background: var(--pi-surface-hover); } }
  .action-menu-panel { position: fixed; z-index: var(--pi-layer-popover); box-sizing: border-box; min-width: min(120px, calc(100vw - 16px)); overflow: auto; padding: var(--pi-space-2); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); box-shadow: 0 8px 24px var(--pi-shadow); overflow-wrap: anywhere; }
  .action-menu-panel button { display: block; width: 100%; text-align: left; white-space: normal; overflow-wrap: anywhere; border: 0; background: transparent; color: var(--pi-text); }
  @media (hover: hover) { .action-menu-panel button:hover { background: var(--pi-selection-bg); } }
  button.selected { border-color: var(--pi-accent); background: var(--pi-selection-bg); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  small { display: block; color: var(--pi-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .workspace-label { min-width: 0; display: inline-flex; align-items: baseline; gap: var(--pi-space-3); max-width: 100%; overflow: hidden; white-space: nowrap; }
  .workspace-label-base, .workspace-label-item, .workspace-label-render { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .workspace-label-item, .workspace-label-render, .workspace-label-separator { color: var(--pi-muted); }
  .workspace-label-link { color: var(--pi-accent); text-decoration: none; }
  .workspace-label-link:focus { text-decoration: underline; }
  @media (hover: hover) { .workspace-label-link:hover { text-decoration: underline; } }
  .workspace-detail-row .workspace-label { overflow: visible; white-space: normal; flex-wrap: wrap; }
  .workspace-detail-row .workspace-label-base, .workspace-detail-row .workspace-label-item, .workspace-detail-row .workspace-label-render { overflow: visible; text-overflow: clip; overflow-wrap: anywhere; white-space: normal; }
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
  .code-copy-button:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  @media (hover: hover) { .code-copy-button:hover { color: var(--pi-text); border-color: var(--pi-accent); } }
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





