import { css, LitElement, html, type TemplateResult } from "lit";
import { scrollbarWidthOf } from "../scrollbarWidth";
import { dropsExpansionAsWorkFinishes } from "../topDrawerExpansion";
import { showsJumpToBottom } from "../chatScrollPosition";
import { ScrollFollowGate } from "../scrollFollowGate";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { groupChatMessages, summarizeChatGroup, tryAppendGroupChatMessage, type ChatGroup } from "../chatGroups";
import { writeClipboardText } from "../clipboard";
import { capturePrependScrollAnchor, PREPEND_RESTORE_SETTLE_FRAMES, restorePrependScrollAnchor, type PrependScrollAnchor } from "../chatScrollAnchoring";
import { shouldRequestEarlierMessages } from "../chatHistoryLoading";
import { ChatScrollController, distanceFromScrollBottom, findFirstVisibleArticle, isNearScrollBottom, type ChatAnchorScrollPosition, type ChatScrollRestoreResult } from "../chatScrollPosition";
import { scrollEdgeClasses, ScrollEdgeTracker } from "../scrollEdges";
import type { AskUserSubmission, PendingAskUser, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionStatus, SessionWarningSeverity } from "../api";
import type { ActivityOutputView, ClosedExtensionDialog } from "../appState";
import {
  notificationAnnouncementLabel,
  notificationDismissLabel,
  notificationFocusTargetAfterDismiss,
  notificationInboxOverflowLabel,
  notificationInboxTotalCount,
  notificationMessageTruncationLabel,
  notificationSeverityLabel,
  notificationTargetKey,
  notificationTrayHeading,
  type NotificationFocusTarget,
  type SelectedSessionNotificationView,
  type SessionNotificationTarget,
} from "../sessionNotifications";
import { isResendableLine, recoverPromptFromLine, type RecoveredPrompt } from "../resendMessage";
import "./GoalPanel";
import type { GoalRecordSummary } from "../api";
import { describeRunModel } from "../modelIdentity";
import { isWaitingForUser } from "../sessionWaiting";
import type { SessionBackgroundTaskInfo, SessionNotification, SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import type { ChatLine, ChatPart, MessageDelivery } from "./shared";
import { renderSessionWarningIcon} from "./shared";
import type { SessionStateBadgeKind } from "./activityBadge";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import { deliveryTaken, splitTranscriptAndPending } from "../messageDelivery";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";
import "./ConversationMeter";
import "./FormattedText";
import "./ToolExecutionView";
import { sessionStateBadgeStyles as SessionStateBadgeStyles } from "./sessionStateBadgeStyles";

export const chatStyles = css`
  ${SessionStateBadgeStyles}
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
  .attachment-zoom-close:hover, .attachment-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  /* Tap targets should not wait for a double-tap-zoom gesture to be ruled out.
     Scoped to controls, so scrollable and pannable surfaces keep the gestures
     they set for themselves; and it lives here rather than on the app shell
     because shell styles do not cross a component's shadow boundary. */
  button, [role="button"], input, select, summary { font: var(--pi-text-xs) var(--pi-font-ui); touch-action: manipulation; }
  :host { position: relative; z-index: 0; display: flex; flex-direction: column; min-height: 0; overflow: hidden; color: var(--pi-text); font: var(--pi-text-base) var(--pi-font-ui); }
  .chat-wrap { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
  /* Sits over the transcript's bottom-right corner, clear of the reading
     column, and only while the newest message is out of reach. 40px keeps it
     above the 24px minimum target without becoming a second composer. */
  /* Bottom right, the corner a reader scrolling down already watches.

     It was moved to the top once, because the bottom edge was where the
     composer controls and a full-width activity dock all lived and one more
     round control there read as one of them. Two of those three reasons are
     gone: the dock is a row of its own now and the quiet states hug their
     words, so the corner is free. The third is answered by shape - this is a
     square panel affordance, not another pill.

     What it must not do is land on the dock, which changes height with its
     state and grows on a touch screen. CSS cannot measure that, so the row it
     has to clear is measured and spent as a length, the same way the scrollbar
     is.

     Its edges come from the conversation rather than from the panel. A fixed
     offset from the panel measured correctly here, where the scrollbar floats
     over the content, and sat on top of a real scrollbar elsewhere.

     The measure is the full column, so the gutter alone put the button's right
     edge exactly on the message's own right border: two edges on one line,
     reading as a button welded to the card rather than one floating over it.
     It is inset by a step of the scale so the border stays visible. */
  .jump-to-bottom {
    position: absolute;
    right: calc(var(--pi-chat-gutter) + var(--pi-chat-scrollbar, 0px) + var(--pi-space-4));
    bottom: calc(var(--pi-chat-dock-room, 0px) + var(--pi-space-4)); z-index: var(--pi-layer-sticky);
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; padding: 0;
    border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md);
    background: var(--pi-surface); color: var(--pi-text);
    font-size: 18px; line-height: 1; cursor: pointer;
    box-shadow: 0 2px 8px rgb(0 0 0 / 25%);
  }
  .jump-to-bottom:hover, .jump-to-bottom:focus-visible { border-color: var(--pi-accent); }
  .top-notices { box-sizing: border-box; flex: 0 0 auto; max-height: 40%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; border-bottom: 1px solid var(--pi-border); background: var(--pi-bg-overlay); }
  /* Subagents strip: child sessions spawned by the parent conversation. The
     strip must read at one glance -- who is still working, who finished --
     and every row is a real button large enough to open with a thumb. */
  /* One drawer, two sections. It is chrome, not transcript: it sits on the app
     background rather than the message surface so it cannot be mistaken for a
     reply. Tabs rather than a stack, because two stacked scrollers on a short
     window give each a sliver and neither is usable. */
  .top-drawer { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; box-sizing: border-box; background: color-mix(in srgb, var(--pi-purple) 7%, var(--pi-bg)); border-bottom: 1px solid var(--pi-purple-border); }
  .top-drawer.collapsed { flex: 0 0 auto; }
  /* On a phone the drawer used to get whatever height was left, which clipped
     a goal's title mid-line. Taking the whole column instead was worse: the
     way back went off the top of a tab strip that scrolls sideways, and the
     transcript disappeared, so the reader was stranded.

     It stays a drawer over the transcript - which is what makes leaving it
     obvious - and simply gets room: up to three fifths of the screen, with its
     own scroll, and a header that stays put so the control that closes it is
     always where it was. */
  @media (max-width: 640px) {
    .top-drawer:not(.collapsed) { flex: 0 1 auto; max-height: 60vh; }
    .top-drawer:not(.collapsed) .drawer-header { position: sticky; top: 0; z-index: 1; background: var(--pi-bg); }
    .top-drawer:not(.collapsed) .drawer-body { flex: 1 1 auto; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  }
  .drawer-header { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-3); box-sizing: border-box; min-height: var(--pi-panel-header-height); padding: var(--pi-space-2) var(--pi-space-4); }
  /* The two sections are told apart by colour, not only by label: activity is
     violet (work this chat started), notifications keep the app's warning
     palette (something happened to you). */
  .drawer-tab-activity.selected { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); color: var(--pi-purple); }
  .drawer-tab-notifications.selected { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
  .drawer-header:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: -3px; }
  /* Two tabs need 261px and get 240 on a phone, with the scrollbar hidden. */
  .drawer-tabs-frame { position: relative; flex: 1 1 auto; min-width: 0; }
  .drawer-tabs-frame::before, .drawer-tabs-frame::after { content: ""; position: absolute; top: 0; bottom: 0; z-index: 2; width: 18px; opacity: 0; pointer-events: none; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
  .drawer-tabs-frame::before { left: 0; background: linear-gradient(90deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .drawer-tabs-frame::after { right: 0; background: linear-gradient(270deg, color-mix(in srgb, var(--pi-shadow-strong) 55%, transparent) 0%, transparent 100%); }
  .drawer-tabs-frame.can-scroll-left::before, .drawer-tabs-frame.can-scroll-right::after { opacity: 1; }
  .drawer-tabs { min-width: 0; display: flex; align-items: center; gap: var(--pi-space-2); overflow-x: auto; scrollbar-width: none; }
  .drawer-tabs::-webkit-scrollbar { display: none; }
  /* A section that shortens stays reachable. Refusing to shrink pushed the
     others off a narrow screen, where the selected one scrolled into view and
     took the rest out of sight - which read as the strip disappearing. */
  /* A section name is short and carries a count; cutting it to "ACTIVITY (..."
     loses the number, which is the part worth reading. The names keep their
     width and the running summary beside them gives way instead. */
  .drawer-tab { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-3); box-sizing: border-box; min-height: 22px; padding: var(--pi-space-1) var(--pi-space-4); border: 1px solid transparent; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); font: inherit; font-size: var(--pi-text-2xs); font-weight: 600; letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .drawer-tab:hover { color: var(--pi-text-bright); }
  .drawer-tab:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .drawer-tab, .activity-filter, .activity-history-toggle { transition: background-color var(--pi-motion-fast) var(--pi-ease), border-color var(--pi-motion-fast) var(--pi-ease), color var(--pi-motion-fast) var(--pi-ease); }
  .drawer-tab.selected { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text-bright); }
  .drawer-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-1); }
  .drawer-body { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .drawer-body[hidden] { display: none; }
  .activity-filters { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; gap: var(--pi-space-2); margin-bottom: var(--pi-space-2); padding-bottom: var(--pi-space-2); background: color-mix(in srgb, var(--pi-purple) 7%, var(--pi-bg)); }
  .activity-filter { display: inline-flex; align-items: center; gap: var(--pi-space-2); min-height: 26px; padding: var(--pi-space-1) var(--pi-space-4); border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-pill); background: transparent; color: var(--pi-muted); font: inherit; font-size: var(--pi-text-2xs); cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .activity-filter:hover { color: var(--pi-text-bright); }
  .activity-filter:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .activity-filter.selected { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); color: var(--pi-purple); }
  .activity-filter-count { color: var(--pi-muted); font-variant-numeric: tabular-nums; }
  .activity-filter.selected .activity-filter-count { color: inherit; }
  @media (pointer: coarse) {
    .activity-filter { min-height: 44px; }
  }
  .subagents-list { mask-image: linear-gradient(to bottom, #000 calc(100% - 14px), transparent 100%); flex: 0 1 auto; min-height: 0; max-height: min(34vh, 260px); display: grid; gap: var(--pi-space-3); align-content: start; overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 var(--pi-space-5) var(--pi-space-5); }
  .subagents-list[hidden] { display: none; }
  /* Two fixed lines per row: the identity line never reflows, and the detail
     line is one clipped line, because a subagent's task text is a paragraph
     and a strip that grows with it is the bug this replaced. */
  .subagent-row { box-sizing: border-box; min-width: 0; display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto auto auto; align-items: center; gap: var(--pi-space-2) var(--pi-space-4); min-height: 38px; padding: var(--pi-space-4) var(--pi-space-5); border: 1px solid var(--pi-border-muted); border-inline-start: 4px solid var(--pi-dim); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; text-align: start; transition: background var(--pi-motion-fast) var(--pi-ease), border-color var(--pi-motion-fast) var(--pi-ease); }
  .subagent-row:hover, .subagent-row:focus-visible { background: var(--pi-surface-hover); }
  .subagent-row:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  /* A row with no output to open is not a button in any useful sense; say so
     instead of letting a thumb bounce off it. */
  .subagent-row:disabled { cursor: default; opacity: .72; }
  .subagent-row:disabled:hover { background: var(--pi-surface); }
  /* Status changes under the reader's eyes - a row goes running to done while
     the drawer is open - so the colours that carry that meaning move rather
     than jump. Paint only: animating the row's size would shift every row
     below it. The reduced-motion block above collapses these to nothing. */
  .subagent-row { transition: background-color var(--pi-motion-base) var(--pi-ease), border-color var(--pi-motion-base) var(--pi-ease); }
  .subagent-row.status-working, .subagent-row.status-running { border-color: var(--pi-accent-border); border-inline-start-color: var(--pi-accent); background: color-mix(in srgb, var(--pi-accent) 14%, var(--pi-surface)); }
  .subagent-row.status-idle, .subagent-row.status-done { border-inline-start-color: var(--pi-success); background: color-mix(in srgb, var(--pi-success) 7%, var(--pi-surface)); }
  .subagent-row.status-error, .subagent-row.status-failed { border-inline-start-color: var(--pi-danger); background: color-mix(in srgb, var(--pi-danger) 8%, var(--pi-surface)); }
  .subagent-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; background: var(--pi-muted); }
  .subagent-dot.working, .subagent-dot.running { background: var(--pi-accent); animation: pulse 1s ease-in-out infinite; }
  .subagent-dot.idle, .subagent-dot.done { background: var(--pi-success); }
  .subagent-dot.error, .subagent-dot.failed { background: var(--pi-danger); }
  /* The kind, in a word: the filter chips name the same three categories, so a
     row says which one it is without the reader inferring it from the shape. */
  .subagent-kind { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-2xs); text-transform: uppercase; letter-spacing: .04em; }
  /* What the run is on. Quiet: it answers "which model, at what thinking
     level" for a reader scanning a fleet, without competing with the agent's
     own name. */
  .subagent-model { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pi-muted); font-size: var(--pi-text-2xs); font-variant-numeric: tabular-nums; }
  .subagent-id { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--pi-font-ui); font-size: var(--pi-text-sm); font-weight: var(--pi-weight-medium); letter-spacing: -0.01em; color: var(--pi-text-bright); }
  .subagent-status { flex: 0 0 auto; padding: 1px var(--pi-space-4); border-radius: var(--pi-radius-pill); background: var(--pi-border-muted); color: var(--pi-muted); font-size: var(--pi-text-2xs); font-weight: 600; letter-spacing: .02em; white-space: nowrap; }
  .subagent-row .subagent-status.working, .subagent-row .subagent-status.running { background: var(--pi-selection-bg); color: var(--pi-accent); }
  .subagent-row .subagent-status.idle, .subagent-row .subagent-status.done { background: var(--pi-success-surface); color: var(--pi-success); }
  .subagent-row .subagent-status.error, .subagent-row .subagent-status.failed { background: color-mix(in srgb, var(--pi-danger) 18%, transparent); color: var(--pi-danger); }
  .subagent-duration { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-2xs); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .subagent-detail { grid-column: 3 / -1; min-width: 0; overflow: hidden; color: var(--pi-muted); font-size: var(--pi-text-xs); line-height: var(--pi-leading-tight); text-overflow: ellipsis; white-space: nowrap; }
  .activity-empty { margin: var(--pi-space-2) 0; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  /* Quiet, full-width and last: the history is available without competing
     with the work that is actually running. */
  .activity-history-toggle { justify-self: stretch; min-height: 30px; margin-top: var(--pi-space-1); border: 1px dashed var(--pi-border); border-radius: var(--pi-radius-md); background: transparent; color: var(--pi-muted); font: inherit; font-size: var(--pi-text-2xs); cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .activity-history-toggle:hover, .activity-history-toggle:focus-visible { border-color: var(--pi-purple-border); color: var(--pi-purple); }
  .activity-history-toggle:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .subagent-chevron { flex: 0 0 auto; color: var(--pi-muted); font-size: var(--pi-text-xs); }
  /* One rule for the whole drawer: the project sets 44px as its touch height
     (--pi-control-height-touch), and controls added a few at a time had drifted
     to 30, 32, 36 and 40. Placed after every base declaration it overrides -
     a media query carries no extra specificity, so the same rule written
     earlier in the sheet loses to the base height it was meant to raise. */
  @media (pointer: coarse) {
    .drawer-tab, .subagent-row, .activity-history-toggle { min-height: 44px; }
    .drawer-header { min-height: 44px; }
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
  .notification-control, .notification-row-dismiss { box-sizing: border-box; min-height: 32px; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); cursor: pointer; }
  .notification-control { padding: 0 var(--pi-space-4); font: var(--pi-text-xs) var(--pi-font-ui); white-space: nowrap; }
  .notification-toggle { display: inline-grid; place-items: center; width: 32px; height: 32px; padding: 0; }
  .notification-control:hover, .notification-control:focus-visible, .notification-row-dismiss:hover, .notification-row-dismiss:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  .notification-control:focus-visible, .notification-row-dismiss:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .notification-control:disabled, .notification-row-dismiss:disabled { opacity: .5; background: transparent; cursor: default; }
  .notification-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .notification-disclosure-icon.expanded { transform: rotate(90deg); }
  .notification-close-icon { width: 16px; height: 16px; }
  .notification-list { flex: 0 1 auto; min-height: 0; max-height: min(38vh, 320px); overflow-y: auto; overscroll-behavior-y: contain; box-sizing: border-box; padding: 0 var(--pi-space-5) var(--pi-space-3); }
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
    .notification-control, .notification-row-dismiss, .notification-row-copy { min-height: 40px; }
    .notification-toggle, .notification-row-dismiss, .notification-row-copy { width: 40px; height: 40px; }
    .notification-row { padding-right: 46px; }
  }
  @media (max-width: 520px) {
    .drawer-header { gap: var(--pi-space-2); padding-inline: 8px; }
    .drawer-tab { padding-inline: var(--pi-space-4); }
    .notification-list, .subagents-list { padding-inline: 8px; }
  }
  /* A short window is the case the drawer was breaking: keep it to a slice of
     the viewport so the transcript never becomes a letterbox. */
  @media (max-height: 620px) {
    /* Enough for two rows, or the drawer is a header with nothing under it -
       measured at 390x400 (a phone with the keyboard up): 28px of viewport for
       456px of content, and the sticky filter row alone was taller than that. */
    .subagents-list { max-height: 26vh; min-height: 96px; }
    .notification-list { max-height: 30vh; min-height: 96px; }
    .activity-filters { position: static; }
  }
  .chat { flex: 1 1 auto; --pi-chat-sticky-top: -26px; height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: 26px var(--pi-chat-gutter) 64px; box-sizing: border-box; }
  .scroll-marker { display: block; height: 0; overflow: hidden; pointer-events: none; }
  .activity-dock { flex: 0 0 auto; margin: 0 var(--pi-chat-gutter) 10px; z-index: var(--pi-layer-sticky); display: flex; align-items: center; gap: var(--pi-space-4); min-width: 0; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-bg-overlay); color: var(--pi-muted); padding: var(--pi-space-4) var(--pi-space-6); font-size: var(--pi-text-sm); pointer-events: none; box-shadow: 0 8px 28px var(--pi-shadow); backdrop-filter: blur(6px); }
  /* Idle is the state nobody needs a full-width banner for: keep the signal,
     drop the bar that looked like an empty card above the composer.

     Setting the right edge to auto was how that worked while the dock was
     placed by coordinates: an absolute box with a free edge shrinks to fit.
     The dock is a row in the column now, and a row stretches, so the rule
     stopped hugging and started drawing a fixed 240px stub with one word in
     its left corner - the empty card again, only narrower. A row hugs when it
     is told to. */
  .activity-dock.idle { width: fit-content; max-width: min(60%, 240px); opacity: .75; padding: var(--pi-space-2) var(--pi-space-5); font-size: var(--pi-text-xs); }
  /* Waiting on an answer is one short phrase too, and a phrase stretched over
     1223px of empty bar is the same empty card in a different colour. Only the
     working state keeps the full row, because it carries the elapsed clock at
     the far end and needs the distance between the two. */
  .activity-dock.asking { width: fit-content; max-width: min(80%, 420px); }
  /* Idle turn, live children: readable as "waiting on something", not as the
     assistant working. */
  /* The one dock state that is a control, so it opts back into pointer events
     and carries an affordance. */
  .activity-dock.background { width: fit-content; max-width: min(70%, 300px); border-color: var(--pi-purple-border); color: var(--pi-purple); padding: var(--pi-space-2) var(--pi-space-5); font: inherit; font-size: var(--pi-text-xs); pointer-events: auto; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  .activity-dock { transition: color var(--pi-motion-base) var(--pi-ease), background-color var(--pi-motion-base) var(--pi-ease), border-color var(--pi-motion-base) var(--pi-ease); }
  .activity-dock.background:hover, .activity-dock.background:focus-visible { border-color: var(--pi-purple); background: var(--pi-purple-surface); }
  @media (pointer: coarse) { .activity-dock.background { min-height: 44px; padding-block: var(--pi-space-4); } }
  .activity-dock.background:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 2px; }
  .activity-dock.background .subagent-chevron { color: inherit; }
  .activity-dock.background .dot { background: currentColor; opacity: 1; animation: pulse 1s ease-in-out infinite; }
  .activity-elapsed { flex: 0 0 auto; margin-left: auto; color: inherit; font-size: var(--pi-text-2xs); font-variant-numeric: tabular-nums; opacity: .85; }
  /* A turn that has run for ten minutes without finishing is worth a second
     look; the reader has no other way to tell it from one that just started. */
  .activity-dock.long-running { border-color: var(--pi-warning-border); color: var(--pi-warning); }
  .activity-dock.active { border-color: var(--pi-success-border); color: var(--pi-success); background: var(--pi-success-bg-overlay); }
  .activity-dock.sending { border-color: var(--pi-warning-border); color: var(--pi-warning); background: var(--pi-warning-surface); }
  .activity-dock.asking { border-color: var(--pi-warning-border); color: var(--pi-warning); background: var(--pi-warning-bg-overlay); }
  .activity-dock.error { border-color: var(--pi-danger-border); color: var(--pi-danger); background: var(--pi-danger-bg-overlay); }
  .activity-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity-dock.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .activity-dock .state-dot { background: currentColor; }
  .activity-dock.working .state-dot { opacity: 1; }
  /* One column, shared by the transcript, the composer and the status dock.
     A wide screen is bought to be used, so the column takes the width it is
     given and keeps only a gutter at each edge. Everything that belongs to
     the conversation measures from this one value, so the three surfaces line
     up on a single left edge at every window size. */
  .chat > * { margin-inline: auto; }
  .msg { max-width: var(--pi-chat-measure); min-width: 0; box-sizing: border-box; margin: 0 auto var(--pi-space-7); padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); overflow: visible; }
  .msg.assistant, .msg.tool-image-output { background: var(--pi-surface); }
  .msg.user { border-color: var(--pi-accent-border); background: var(--pi-selection-bg); }
  /* Held by the server, not yet read: the same warning colour the queue panel
     uses, so "waiting" looks the same wherever it appears. It reverts to the
     ordinary user colour the moment the agent takes the message, which is also
     when the recall action disappears - one change of state, said twice. */
  .msg.user.queued { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); }
  .msg.user.queued > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); background: var(--pi-warning-surface); }
  .msg.user.queued > .msg-header .label { color: var(--pi-warning); }
  .msg.user.queued .msg-action { color: var(--pi-warning); }
  .msg.tool { border-color: var(--pi-warning-border); background: var(--pi-warning-surface); color: var(--pi-warning); }
  .msg.tool-execution-shell, .msg.ask-user-record-shell { padding: 0; border: 0; background: transparent; color: var(--pi-text); }
  .msg.ask-user-record-shell ask-user-card { margin: 0 auto; }
  /* A system line reports whatever the runtime has to say - a background task
     that finished with exit 0 as often as a failure - so it is not coloured as
     a fault. A genuine error arrives as an error line and keeps the red. */
  .msg.system { color: var(--pi-muted); }
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
  dialog.activity-output { position: fixed; inset: 0; margin: auto; box-sizing: border-box; width: min(92vw, 900px); max-height: calc(88vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); padding: 0; color: var(--pi-text); background: var(--pi-surface); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); overflow: hidden; }
  dialog.activity-output[open] { display: flex; flex-direction: column; }
  dialog.activity-output::backdrop { background: rgba(0, 0, 0, 0.6); }
  .activity-output-head { display: flex; align-items: center; gap: var(--pi-space-3); padding: var(--pi-space-4) var(--pi-space-5); border-bottom: 1px solid var(--pi-border-muted); }
  .activity-output-title { flex: 1; min-width: 0; margin: 0; font-size: var(--pi-font-size-sm, 13px); font-weight: 600; color: var(--pi-text-bright); overflow-wrap: anywhere; }
  .activity-output-close { display: inline-grid; place-items: center; flex: none; width: 44px; height: 44px; margin: calc(-1 * var(--pi-space-2)) calc(-1 * var(--pi-space-2)) calc(-1 * var(--pi-space-2)) 0; padding: 0; font: 18px/1 system-ui, sans-serif; color: var(--pi-muted); background: transparent; border: none; border-radius: var(--pi-radius-sm); cursor: pointer; }
  .activity-output-close:hover, .activity-output-close:focus-visible { color: var(--pi-text-bright); }
  .activity-output-close:focus-visible { outline: 1px solid var(--pi-border); outline-offset: -2px; }
  .activity-output-body { flex: 1; min-height: 0; margin: 0; padding: var(--pi-space-4) var(--pi-space-5); font: var(--pi-code-font-size, 12px)/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; overflow: auto; overscroll-behavior: contain; }
  .activity-output-empty { margin: 0; padding: var(--pi-space-6) var(--pi-space-5); color: var(--pi-muted); text-align: center; }
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: var(--pi-space-5) 0; border-top: 1px solid var(--pi-border-muted); color: var(--pi-text); overflow: visible; }
  .group-msg.tool { color: var(--pi-warning); }
  .group-msg.tool-execution-shell { color: var(--pi-text); }
  .group-msg.system { color: var(--pi-muted); }
  .group-msg.bash { color: var(--pi-success); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 auto var(--pi-space-7); color: var(--pi-muted); font-size: var(--pi-text-xs); text-align: center; }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text-secondary); padding: var(--pi-space-3) var(--pi-space-6); font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
  .history-load-button:hover, .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  /* Queued messages are drawn in the transcript, gold; this slim strip carries
     only the count and the clear action the queue as a whole needs. */
  .queued-strip { display: flex; align-items: center; gap: var(--pi-space-3); margin: 0 0 var(--pi-space-4); padding: var(--pi-space-2) var(--pi-space-3); color: var(--pi-warning); font-size: var(--pi-text-xs); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: var(--pi-warning-surface); }
  .queued-strip-count { flex: 1 1 auto; min-width: 0; }
  .queued-clear-button { flex: 0 0 auto; border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: transparent; color: var(--pi-warning); padding: var(--pi-space-1) var(--pi-space-3); font: inherit; cursor: pointer; }
  .queued-clear-button:hover, .queued-clear-button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
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
  .session-activity { max-width: 100%; min-width: 0; box-sizing: border-box; display: grid; gap: var(--pi-space-2); margin: 0 auto var(--pi-space-7); padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface); color: var(--pi-text); overflow: hidden; }
  .session-activity.compacting { border-color: var(--pi-purple-border); background: var(--pi-purple-surface); }
  .session-activity strong { color: var(--pi-purple); }
  .session-activity span, .session-activity small { color: var(--pi-muted); }
  .history-boundary small { color: var(--pi-dim); }
  /* Centred in the room the transcript is not using, so the words land where
     the reader is already looking rather than clinging to the top edge. */
  .empty-session { display: grid; justify-items: center; gap: var(--pi-space-5); margin: var(--pi-space-9) auto; max-width: var(--pi-chat-measure); padding: var(--pi-space-7); color: var(--pi-muted); text-align: center; }
  .empty-session p { margin: 0; }
  .empty-session button { min-height: var(--pi-control-height); padding: var(--pi-space-3) var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md); background: var(--pi-surface); color: var(--pi-text); cursor: pointer; }
  .empty-session button:hover, .empty-session button:focus-visible { border-color: var(--pi-accent); }
  @media (pointer: coarse) { .empty-session button { min-height: var(--pi-control-height-touch); } }
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-5); min-height: 18px; margin-bottom: var(--pi-space-3); }
  .msg > .msg-header { position: sticky; top: -16px; z-index: 4; margin: -12px -12px var(--pi-space-3); padding: var(--pi-space-1) var(--pi-space-5); border-radius: var(--pi-radius-md) var(--pi-radius-md) 0 0; border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-surface); box-shadow: 0 8px 18px var(--pi-shadow-soft); }
  .msg.user > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-accent-border) 35%, transparent); background: var(--pi-selection-bg); }
  .msg.assistant > .msg-header .label, .msg.tool-image-output > .msg-header .label { color: var(--pi-text-secondary); }
  .msg.user > .msg-header .label { color: var(--pi-accent); }
  .msg.tool > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); background: var(--pi-warning-surface); }
  .msg.bash > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-success) 35%, transparent); background: var(--pi-success-bg); }
  .msg.skill > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-purple-border) 35%, transparent); background: var(--pi-purple-surface); }
  .group-msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -10px 0 var(--pi-space-4); padding: var(--pi-space-4) 0 var(--pi-space-3); border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-bg); }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--pi-space-4); }
  .msg-actions { flex: 0 0 auto; display: inline-flex; gap: var(--pi-space-3); opacity: 0; transition: opacity var(--pi-motion-fast) var(--pi-ease); }
  .msg-action { position: relative; display: inline-grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); background: var(--pi-surface); color: var(--pi-muted); padding: 0; font: var(--pi-text-base) var(--pi-font-ui); line-height: 1; cursor: pointer; }
  /* A fingertip is wider than the drawn button, so the reach grows, not the icon. */
  .msg-action::after { content: ""; position: absolute; inset: -10px; }
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
  formatted-text.part { text-align: start; unicode-bidi: plaintext; }
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

/** Gap between the activity dock and the control that floats above it. */
const DOCK_CLEARANCE_PX = 8;

const messageTimestampFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
const notificationTimestampFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

/** Narrow the previous-status slot of a change to the one field queueGrew reads. */
function recordWithQueuedMessages(value: unknown): { queuedMessages?: readonly QueuedSessionMessage[] } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const queued: unknown = Reflect.get(value, "queuedMessages");
  if (!Array.isArray(queued)) return undefined;
  return { queuedMessages: queued };
}

function renderNotificationDisclosureIcon(collapsed: boolean) {
  return html`
    <svg class=${`notification-icon notification-disclosure-icon${collapsed ? "" : " expanded"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `;
}

function renderNotificationCloseIcon() {
  return html`
    <svg class="notification-icon notification-close-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M6 6l12 12"></path>
      <path d="M18 6 6 18"></path>
    </svg>
  `;
}

function isSessionNotificationTarget(value: unknown): value is SessionNotificationTarget {
  return typeof value === "object"
    && value !== null
    && typeof Reflect.get(value, "machineId") === "string"
    && typeof Reflect.get(value, "cwd") === "string"
    && typeof Reflect.get(value, "sessionId") === "string";
}

function clampPercent(value: number): number {
  return clampNumber(value, 0, 100);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface PendingNotificationFocus {
  chatKey: string;
  focusTarget: NotificationFocusTarget;
}


export interface DeliveryPresentation {
  glyph: string;
  text: string;
  label: string;
  tone: "pending" | "received" | "delivered" | "failed";
}

/**
 * How one delivery state reads on a bubble. The glyph carries the state at a
 * glance and the words carry it for anyone who cannot tell one tick from two -
 * both are needed, so neither is decoration.
 */
/**
 * A marker reports an outcome that is not settled yet. Messages read back from
 * the transcript carry no delivery record and showed nothing, while messages
 * sent this session kept a double tick forever, so the same settled message
 * looked one way before a reload and another way after.
 */
export function chatDeliveryMarkerVisible(delivery: MessageDelivery | undefined): boolean {
  return delivery !== undefined && !deliveryTaken(delivery.state);
}

export function chatDeliveryPresentation(delivery: MessageDelivery): DeliveryPresentation {
  if (delivery.state === "sending") return { glyph: "◌", text: "Sending", label: "Sending", tone: "pending" };
  if (delivery.state === "failed") return { glyph: "!", text: "Not sent", label: "Not sent - the server never received this message", tone: "failed" };
  if (delivery.state === "queued") {
    const lane = delivery.kind === "steer" ? "Queued to steer" : "Queued";
    return { glyph: "✓", text: lane, label: `${lane} - the server has this message and the agent will take it next`, tone: "received" };
  }
  if (delivery.state === "received") return { glyph: "✓", text: "Sent", label: "Sent - the server received this message", tone: "received" };
  return { glyph: "✓✓", text: "Read", label: "Read - the agent took this message into the conversation", tone: "delivered" };
}

export type ChatImagePart = Extract<ChatPart, { type: "image" }>;

/** Derive the `<img>` source URL and alt text for a rendered image part. */
export function chatImagePartSource(part: ChatImagePart): { src: string; alt: string } {
  return { src: `data:${part.mimeType};base64,${part.data}`, alt: "attached image" };
}

/** The message-header label used when a tool message renders as an image output. */
export function chatToolOutputLabel(toolName?: string): string {
  return toolName === undefined || toolName === "" ? "tool output" : `${toolName} output`;
}

/** The stable scroll-anchor/render key for a top-level message at `index`. */
export function chatMessageAnchorKey(index: number): string {
  return `m:${String(index)}`;
}

/** The stable scroll-anchor/render key for a collapsed event group starting at `startIndex`. */
export function chatGroupAnchorKey(startIndex: number): string {
  return `g:${String(startIndex)}`;
}

/** The stable scroll-anchor key for an event inside a group at `index`. */
export function chatEventAnchorKey(index: number): string {
  return `e:${String(index)}`;
}

/** The stable scroll-marker id emitted before an event group ending at `endIndex`. */
export function chatGroupScrollMarkerId(endIndex: number): string {
  return `g:${String(endIndex)}`;
}

/** The CSS class list for an event-group `<details>`, distinguishing the live tail. */
export function chatMessageGroupClassName(defaultOpen: boolean): string {
  return defaultOpen ? "msg event-group live" : "msg event-group";
}

/** The disclosure summary label for an event group, distinguishing the live tail. */
export function chatMessageGroupLabel(defaultOpen: boolean): string {
  return defaultOpen ? "live events" : "events";
}

/** A rendered session-warning row derived from live status warnings. */
export interface ChatSessionWarningRow {
  severity: SessionWarningSeverity;
  severityClass: string;
  message: string;
  source?: string;
  path?: string;
  dismissId?: string;
}

/** Derive one severity-tagged warning row per live status warning, in order. */
export function chatSessionWarningRows(status: SessionStatus | undefined): ChatSessionWarningRow[] {
  return (status?.warnings ?? []).map((warning) => ({
    severity: warning.severity,
    severityClass: `session-warning ${warning.severity}`,
    message: warning.message,
    ...(warning.source === undefined ? {} : { source: warning.source }),
    ...(warning.path === undefined ? {} : { path: warning.path }),
    ...(warning.dismiss === undefined ? {} : { dismissId: warning.dismiss.id }),
  }));
}

export function chatMessageMetadataLabel(message: ChatLine): string {
  const timestamp = message.meta?.timestamp;
  const time = timestamp === undefined ? undefined : formatMessageTimestamp(timestamp);
  const model = chatMessageModelLabel(message);
  const parts = [time, model, message.meta?.thinkingLevel].filter((part): part is string => part !== undefined && part !== "");
  return parts.join(" · ");
}

function formatMessageTimestamp(timestamp: string): string | undefined {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return undefined;
  return messageTimestampFormatter.format(date);
}

function chatMessageModelLabel(message: ChatLine): string | undefined {
  const model = message.meta?.model;
  if (model === undefined) return undefined;
  const id = model.responseId ?? model.id;
  if (id === undefined || id === "") return model.provider;
  return model.provider !== undefined && model.provider !== "" ? `${model.provider}/${id}` : id;
}

@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatLine[] = [];
  @property() sessionId = "";
  @property({ type: Number }) messageStart = 0;
  @property({ type: Number }) messageEnd = 0;
  @property({ type: Number }) messageTotal = 0;
  @property({ type: Boolean }) hasMore = false;
  @property({ type: Boolean }) loadingMore = false;
  @property({ type: Boolean }) isSendingPrompt = false;
  @property({ type: Boolean }) isCompacting = false;
  @property({ type: Number }) pendingMessageCount = 0;
  @property({ attribute: false }) clientQueuedMessages: QueuedSessionMessage[] = [];
  @property({ attribute: false }) status?: SessionStatus;
  @property({ attribute: false }) activity?: SessionActivity;
  @property({ attribute: false }) pendingAsk?: PendingAskUser;
  @property({ attribute: false }) askDraftSessionId = "";
  @property({ attribute: false }) onSubmitAsk?: (askId: string, submission: AskUserSubmission) => void | Promise<void>;
  @property({ attribute: false }) pendingDialogs: PendingExtensionDialog[] = [];
  @property({ attribute: false }) closedDialogs: ClosedExtensionDialog[] = [];
  @property({ attribute: false }) onAnswerDialog?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancelDialog?: ExtensionDialogCancelCallback;
  @property({ attribute: false }) onDismissClosedDialog?: ExtensionDialogDismissCallback;
  /**
   * Put a sent prompt back in the composer, images included. Offered on user
   * messages because a turn that fails after delivery leaves the transcript as
   * the only remaining copy of what was sent.
   */
  @property({ attribute: false }) onResendMessage?: (prompt: RecoveredPrompt) => void | Promise<void>;
  @property({ attribute: false }) notificationInbox?: SelectedSessionNotificationView;
  /** Child sessions (subagents) spawned by this session, most urgent first. */
  @property({ attribute: false }) subagents?: readonly SessionSubagentInfo[];
  /** Subagent-tool runs for this session, newest first, live ones first of all. */
  @property({ attribute: false }) subagentRuns?: readonly SessionSubagentRunInfo[];
  @property({ attribute: false }) backgroundTasks?: readonly SessionBackgroundTaskInfo[];
  @property({ attribute: false }) onOpenBackgroundTask?: (task: SessionBackgroundTaskInfo) => void;
  @property({ attribute: false }) onOpenSubagentRun?: (run: SessionSubagentRunInfo) => void;
  /** Open a listed subagent in the navigation. */
  @property({ attribute: false }) onOpenSubagent?: (subagent: SessionSubagentInfo) => void;
  @property({ attribute: false }) onClearServerQueue?: (queued: QueuedSessionMessage[]) => void;
  /** Take one queued message back into the composer, leaving the rest queued. */
  @property({ attribute: false }) onRecallQueuedMessage?: (message: QueuedSessionMessage) => void;
  @property({ attribute: false }) onDismissWarning?: (dismissId: string) => void;
  @property({ attribute: false }) onDismissNotification?: (notificationId: string) => void;
  @property({ attribute: false }) onDismissAllNotifications?: () => void;
  @property({ type: Boolean }) warningsVisible = true;
  @property({ attribute: false }) onToggleWarnings?: () => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  /** Puts the cursor in the composer, for the empty session's way forward. */
  @property({ attribute: false }) onFocusComposer?: () => void;
  /** A log or artifact opened from the activity list, read in its own view. */
  @property({ attribute: false }) activityOutput?: ActivityOutputView | undefined;
  @property({ attribute: false }) onCloseActivityOutput?: () => void;
  @query(".chat") private chat?: HTMLDivElement;
  @query(".drawer-tabs") private drawerTabs?: HTMLElement | null;
  @query("dialog.image-zoom") private imageZoomDialog?: HTMLDialogElement;
  @query("dialog.activity-output") private activityOutputDialog?: HTMLDialogElement;
  @state() private pinnedToBottom = true;
  private readonly followGate = new ScrollFollowGate();
  /** Whether the newest message is far enough away to be worth a button. */
  @state() private jumpToBottomVisible = false;
  @state() private zoomedImage: { src: string; alt: string } | undefined = undefined;
  @state() private expandedMetaKey: string | undefined;
  @state() private copiedNotificationId: string | undefined;
  @state() private copiedMessageKey: string | undefined;
  @state() private currentConversationIndex: number | undefined;
  /** Exact chats whose top drawer the reader folded away, so switching
      conversations does not resurrect a drawer that was dismissed. */
  @state() private collapsedTopDrawerKeys: ReadonlySet<string> = new Set();
  /** Exact chats the reader explicitly unfolded, which outranks the default. */
  @state() private expandedTopDrawerKeys: ReadonlySet<string> = new Set();
  /** Whether the drawer's work was running last time this was looked at. */
  private drawerWorkWasRunning = false;
  /** Section the reader last chose; ignored when that section has nothing. */
  /**
   * The workspace's goals. On a phone the navigation panel that normally shows
   * them is not on screen at all, so a running goal was invisible on the device
   * most likely to be asking what the session is working towards.
   */
  @property({ attribute: false }) goals: GoalRecordSummary[] = [];
  @property({ attribute: false }) onRunGoalCommand?: (goal: GoalRecordSummary, command: string) => void | Promise<void>;
  @state() private topDrawerTab: TopDrawerTab | undefined;
  /** Which kinds of activity to list; "all" until the reader narrows it. */
  @state() private activityFilter: ActivityFilter = "all";
  /** Live work only, until the reader asks for the history. */
  @state() private activityScope: ActivityScope = "active";
  /** When this browser first saw the current turn working, and a clock to age it. */
  @state() private turnStartedAtMs: number | undefined;
  @state() private turnNowMs = 0;
  private turnClockTimer: number | undefined;
  @state() private retainedEmptyNotificationTrayTargetKey: string | undefined;
  private pendingNotificationFocus: PendingNotificationFocus | undefined;
  private imageZoomModalRegistration: RenderedModalRegistration | undefined;
  private activityOutputModalRegistration: RenderedModalRegistration | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrollController = new ChatScrollController();
  private readonly drawerTabEdgeTracker = new ScrollEdgeTracker(() => { this.requestUpdate(); });
  private suppressScrollSave = false;
  private suppressLoadMoreRequests = false;
  private loadMoreCheckFrame: number | undefined;
  private scrollToBottomFrame: number | undefined;
  private scrollToOpenAskFrame: number | undefined;
  private scrollToOpenDialogFrame: number | undefined;
  private conversationRailFrame: number | undefined;
  private groupedMessagesInput?: ChatLine[];
  private groupedMessagesStart = 0;
  private groupedMessagesCache: ChatGroup[] = [];
  private readonly messageMetaCache = new WeakMap<ChatLine, string>();
  private readonly messageCopyTextCache = new WeakMap<ChatLine, string>();
  private lastScrollTop = 0;
  private lastClientHeight = 0;
  private touchStartY: number | undefined;
  private pendingScrollRestoreSessionId: string | undefined;
  private pendingScrollRestorePosition: ChatAnchorScrollPosition | undefined;
  private restoreScrollFrame: number | undefined;
  private prependRestoreToken = 0;
  @state() private loadMoreRequested = false;
  private readonly onViewportResize = () => {
    if (this.pinnedToBottom) this.scrollToBottom();
    else this.lastClientHeight = this.chat?.clientHeight ?? 0;
  };
  private readonly onImageLoad = (): void => {
    if (this.pinnedToBottom) this.scrollToBottom();
  };
  private readonly openImageZoom = (src: string, alt: string): void => {
    this.zoomedImage = { src, alt };
  };
  private readonly closeImageZoom = (): void => {
    if (this.zoomedImage !== undefined) this.zoomedImage = undefined;
  };
  private readonly onImageZoomDialogClick = (event: MouseEvent): void => {
    if (event.target === this.imageZoomDialog) this.closeImageZoom();
  };
  private readonly onPageHide = () => {
    this.saveScrollPosition();
  };
  private readonly handleClearServerQueue = (): void => {
    this.onClearServerQueue?.(this.status?.queuedMessages ?? []);
  };
  private readonly handleToggleWarnings = (): void => {
    this.onToggleWarnings?.();
  };

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this.onViewportResize);
    window.addEventListener("pagehide", this.onPageHide);
    window.visualViewport?.addEventListener("resize", this.onViewportResize);
  }

  protected override firstUpdated(): void {
    this.lastClientHeight = this.chat?.clientHeight ?? 0;
  }

  override disconnectedCallback(): void {
    this.stopTurnClock();
    this.saveScrollPosition();
    this.scrollController.dispose();
    this.drawerTabEdgeTracker.dispose();
    this.releaseImageZoomModal();
    this.releaseActivityOutputModal();
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    if (this.loadMoreCheckFrame !== undefined) cancelAnimationFrame(this.loadMoreCheckFrame);
    if (this.scrollToBottomFrame !== undefined) cancelAnimationFrame(this.scrollToBottomFrame);
    if (this.scrollToOpenAskFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenAskFrame);
      this.scrollToOpenAskFrame = undefined;
    }
    if (this.scrollToOpenDialogFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenDialogFrame);
      this.scrollToOpenDialogFrame = undefined;
    }
    if (this.conversationRailFrame !== undefined) cancelAnimationFrame(this.conversationRailFrame);
    window.removeEventListener("resize", this.onViewportResize);
    window.removeEventListener("pagehide", this.onPageHide);
    window.visualViewport?.removeEventListener("resize", this.onViewportResize);
    super.disconnectedCallback();
  }

  private savePreviousSessionScrollPosition(previousSessionId: unknown): void {
    if (typeof previousSessionId !== "string" || previousSessionId === "" || previousSessionId === this.sessionId) return;
    this.saveScrollPosition(previousSessionId);
  }

  private prepareSessionUiState(): void {
    // The clock measures this session's turn; carrying it across a switch would
    // date the new session's work from the old one's start.
    this.turnStartedAtMs = undefined;
    this.disclosures.syncSession(this.sessionId);
    this.pendingNotificationFocus = undefined;
    this.retainedEmptyNotificationTrayTargetKey = undefined;
    this.scrollController.clearScheduledSave();
    this.suppressScrollSave = false;
    this.suppressLoadMoreRequests = false;
    this.pendingScrollRestoreSessionId = undefined;
    this.pendingScrollRestorePosition = undefined;
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) {
      cancelAnimationFrame(this.restoreScrollFrame);
      this.restoreScrollFrame = undefined;
    }
    if (this.scrollToOpenAskFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenAskFrame);
      this.scrollToOpenAskFrame = undefined;
    }
    if (this.scrollToOpenDialogFrame !== undefined) {
      cancelAnimationFrame(this.scrollToOpenDialogFrame);
      this.scrollToOpenDialogFrame = undefined;
    }
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    this.foldDrawerAsWorkFinishes();
    if (changed.has("sessionId")) {
      this.savePreviousSessionScrollPosition(changed.get("sessionId"));
      this.prepareSessionUiState();
    } else if (changed.has("notificationInbox") && this.notificationTargetChanged(changed.get("notificationInbox"))) {
      this.pendingNotificationFocus = undefined;
      this.retainedEmptyNotificationTrayTargetKey = undefined;
    }
    if (changed.has("messages") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) this.pinnedToBottom = this.pinnedToBottom && (this.didChatHeightChange() || this.isNearBottom());
  }

  protected override update(changed: Map<string, unknown>): void {
    const prependAnchor = this.isPrependingMessages(changed) ? this.capturePrependScrollAnchor() : undefined;
    super.update(changed);
    if (prependAnchor !== undefined) this.restorePrependScrollAnchor(prependAnchor);
  }

  protected override updated(changed: Map<string, unknown>): void {
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    if (changed.has("sessionId")) this.restoreScrollPosition();
    const openedAsk = changed.has("pendingAsk") && this.isNewPendingAsk(changed.get("pendingAsk"));
    const openedDialog = changed.has("pendingDialogs") && this.isNewOpenDialog(changed.get("pendingDialogs"));
    // The form uses the transcript scroller. Start a new long form at question
    // one rather than applying the usual live-tail scroll and landing at its end.
    if (!changed.has("sessionId") && openedAsk && this.pinnedToBottom) this.scrollToOpenAsk();
    else if (!changed.has("sessionId") && openedDialog && this.pinnedToBottom) this.scrollToOpenDialog();
    // A message queued from elsewhere grows the transcript from the bottom. It
    // arrives via the status (status.queuedMessages), not via `messages`, so it
    // would otherwise appear below the fold while the view stays put.
    else if (!changed.has("sessionId") && (changed.has("messages") || this.queueGrew(changed.get("status")) || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) && this.pinnedToBottom) this.scrollToBottom();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("messageTotal") || changed.has("hasMore") || changed.has("loadingMore")) this.scheduleConversationRailUpdate();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) this.continuePendingScrollRestore();
    if (changed.has("messages") || changed.has("hasMore") || changed.has("loadingMore")) this.requestLoadMoreIfNeeded();
    if (changed.has("notificationInbox") && this.pendingNotificationFocus !== undefined) this.focusPendingNotificationTarget();
    if (changed.has("zoomedImage")) this.syncImageZoomDialog();
    if (changed.has("activityOutput")) this.syncActivityOutputDialog();
    this.drawerTabEdgeTracker.observe(this.drawerTabs ?? undefined);
    this.publishScrollbarWidth();
    this.publishDockRoom();
    // A reply that grows the transcript fires no scroll event, so deciding this
    // only while scrolling left a reader who stopped following four screens
    // from the newest message with no way back.
    const chat = this.chat;
    if (chat !== undefined) this.jumpToBottomVisible = showsJumpToBottom(chat);
    if (changed.has("status") || changed.has("activity") || changed.has("isSendingPrompt")) this.syncTurnClock();
  }

  /**
   * Controls pinned to the right edge of the conversation line up with the
   * messages, which sit inside the scrollbar. CSS cannot measure it, so it is
   * measured here and spent as a length.
   */
  private publishScrollbarWidth(): void {
    const width = scrollbarWidthOf(this.chat);
    this.style.setProperty("--pi-chat-scrollbar", `${String(width)}px`);
  }

  /**
   * How much of the bottom edge the activity dock has taken.
   *
   * The way back to the newest message sits in that same corner, and the dock
   * is not one height: it is a hugging pill when the turn is quiet, a full row
   * while the assistant works, and taller again on a touch screen. A guessed
   * offset is therefore wrong in most states - the guess this repository made
   * for a different floating control was out by 62px on three buttons. The row
   * is measured instead, and the button is placed above whatever it turns out
   * to be.
   */
  private publishDockRoom(): void {
    const dock = this.renderRoot.querySelector(".activity-dock");
    const room = dock === null ? 0 : Math.ceil(dock.getBoundingClientRect().height) + DOCK_CLEARANCE_PX;
    this.style.setProperty("--pi-chat-dock-room", `${String(room)}px`);
  }


  private syncImageZoomDialog(): void {
    const dialog = this.imageZoomDialog;
    if (dialog === undefined) return;
    if (this.zoomedImage !== undefined) {
      if (this.imageZoomModalRegistration === undefined) {
        const registration = registerRenderedModal({
          element: dialog,
          nativeTopLayer: true,
          focus: () => {
            const close = this.renderRoot.querySelector<HTMLElement>(".image-zoom-close");
            (close ?? dialog).focus();
          },
        });
        this.imageZoomModalRegistration = registration;
        try {
          if (!dialog.open) dialog.showModal();
        } catch (error) {
          this.imageZoomModalRegistration = undefined;
          registration.unregister();
          throw error;
        }
      }
      this.imageZoomModalRegistration.focus();
      return;
    }
    if (dialog.open) dialog.close();
    this.releaseImageZoomModal();
  }

  private syncActivityOutputDialog(): void {
    const dialog = this.activityOutputDialog;
    if (dialog === undefined) return;
    if (this.activityOutput !== undefined) {
      if (this.activityOutputModalRegistration === undefined) {
        const registration = registerRenderedModal({
          element: dialog,
          nativeTopLayer: true,
          focus: () => {
            const close = this.renderRoot.querySelector<HTMLElement>(".activity-output-close");
            (close ?? dialog).focus();
          },
        });
        this.activityOutputModalRegistration = registration;
        try {
          if (!dialog.open) dialog.showModal();
        } catch (error) {
          this.activityOutputModalRegistration = undefined;
          registration.unregister();
          throw error;
        }
      }
      this.activityOutputModalRegistration.focus();
      return;
    }
    if (dialog.open) dialog.close();
    this.releaseActivityOutputModal();
  }

  private releaseActivityOutputModal(): void {
    const registration = this.activityOutputModalRegistration;
    this.activityOutputModalRegistration = undefined;
    registration?.unregister();
  }

  private releaseImageZoomModal(): void {
    const registration = this.imageZoomModalRegistration;
    this.imageZoomModalRegistration = undefined;
    registration?.unregister();
  }

  private notificationTargetChanged(previous: unknown): boolean {
    const currentInbox = this.notificationInbox;
    if (!isSessionNotificationTarget(previous) || currentInbox === undefined) return previous !== currentInbox;
    return notificationTargetKey(previous) !== notificationTargetKey(currentInbox);
  }

  override render() {
    const groups = this.groupedMessages();
    return html`
      ${this.renderTopNotices()}
      ${this.renderNotificationLiveRegions()}
      <div class="chat-wrap">
        ${this.renderConversationRail()}
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @touchend=${() => { this.onTouchEnd(); }} @touchcancel=${() => { this.onTouchEnd(); }} @pointerdown=${() => { this.followGate.notePointerDown(Date.now()); }} @pointerup=${() => { this.followGate.notePointerUp(Date.now()); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }}>
          ${this.renderHistoryBoundary()}
          ${repeat(
            groups,
            (group) => group.kind === "group" ? this.groupRenderKey(group.startIndex) : this.messageAnchorKey(group.index),
            (group, index) => {
              if (group.kind === "group") return this.renderMessageGroup(group.messages, group.startIndex, group.endIndex, this.isLiveTailGroup(groups, index));
              if (group.kind === "tool-image") return this.renderToolImageOutput(group.message, group.index, group.toolName);
              return this.renderMessage(group.message, group.index);
            },
          )}
          ${this.renderSessionActivity()}
          ${this.renderPendingMessages()}
          ${this.renderQueuedMessages()}
          ${this.renderOpenAsk()}
          ${this.renderExtensionDialogs()}
        </div>
        ${this.renderJumpToBottom()}
        ${this.renderActivityDock()}
      </div>
      ${this.renderImageZoom()}
      ${this.renderActivityOutput()}
    `;
  }

  /**
   * A way back to the newest message, offered only while it is out of reach.
   *
   * A long transcript can be thousands of messages deep, so returning to the
   * newest one otherwise means dragging the whole way back. Near the bottom
   * the button would be covering the transcript to offer a scroll the reader
   * can make by flicking once, so it is not shown there.
   */
  private renderJumpToBottom() {
    if (!this.jumpToBottomVisible) return null;
    return html`
      <button
        class="jump-to-bottom"
        type="button"
        title="Jump to the newest message"
        aria-label="Jump to the newest message"
        @click=${() => { this.pinnedToBottom = true; this.scrollToBottom(); this.jumpToBottomVisible = false; }}
      >↓</button>
    `;
  }

  private renderTopNotices() {
    const warnings = this.renderWarnings();
    const drawer = this.renderTopDrawer();
    if (warnings === null && drawer === null) return null;
    return html`<div class="top-notices">${warnings}${drawer}</div>`;
  }

  /**
   * One drawer above the transcript for everything this conversation is doing
   * besides replying: the subagents/tasks it started, and the notifications it
   * received.
   *
   * They used to stack, so on a short window each got a sliver and both were
   * scrolled surfaces inside a scrolled surface. Tabs give whichever one the
   * reader is asking about the whole drawer, and one control folds the drawer
   * away entirely.
   */
  private renderTopDrawer(): TemplateResult | null {
    const activity = this.activityPanelState();
    const inbox = this.visibleNotificationInbox();
    // Goals count as a reason to have a drawer: on a phone this is the only
    // place they appear, so gating the drawer on the other two sections hid
    // them exactly when nothing else was running.
    if (activity === undefined && inbox === undefined && this.goals.length === 0) return null;
    const tab = selectedTopDrawerTab({ activity: activity !== undefined, notifications: inbox !== undefined, goals: this.goals.length > 0 }, this.topDrawerTab);
    const key = this.topDrawerKey();
    const collapsed = this.expandedTopDrawerKeys.has(key)
      ? false
      : this.collapsedTopDrawerKeys.has(key) || !topDrawerStartsOpen();
    const toggleLabel = collapsed ? "Show session activity and notifications" : "Hide session activity and notifications";
    const notificationCount = inbox === undefined ? 0 : notificationInboxTotalCount(inbox);
    return html`
      <section
        class=${`top-drawer${collapsed ? " collapsed" : ""}`}
        role="region"
        aria-label="Session drawer"
        @focusout=${(event: FocusEvent) => { this.releaseEmptyNotificationTray(event); }}
      >
        <header class="drawer-header" data-notification-focus="header" tabindex="-1">
          <div class=${`drawer-tabs-frame${scrollEdgeClasses(this.drawerTabEdgeTracker.edges)}`}>
          <div class="drawer-tabs" role="tablist" aria-label="Session drawer sections" @scroll=${() => { this.drawerTabEdgeTracker.refresh(); }} @keydown=${(event: KeyboardEvent) => { this.onDrawerTabsKeydown(event); }}>
            ${activity === undefined ? null : html`
              <button
                type="button"
                role="tab"
                id="drawer-tab-activity"
                class=${`drawer-tab drawer-tab-activity${tab === "activity" ? " selected" : ""}`}
                aria-selected=${String(tab === "activity")}
                tabindex=${tab === "activity" ? "0" : "-1"}
                aria-controls="session-activity-list"
                @click=${() => { this.selectTopDrawerTab("activity", collapsed); }}
              >
                ${activity.summary.working ? html`<span class="subagent-dot working" aria-hidden="true"></span>` : null}
                <span class="drawer-tab-label">${activityTabLabel({ active: activity.activeCount })}</span>
              </button>
            `}
            ${inbox === undefined ? null : html`
              <button
                type="button"
                role="tab"
                id="drawer-tab-notifications"
                class=${`drawer-tab drawer-tab-notifications${tab === "notifications" ? " selected" : ""}`}
                aria-selected=${String(tab === "notifications")}
                tabindex=${tab === "notifications" ? "0" : "-1"}
                aria-controls="session-notification-list"
                @click=${() => { this.selectTopDrawerTab("notifications", collapsed); }}
              >
                <span class="drawer-tab-label">${notificationTrayHeading(inbox)}</span>
              </button>
            `}
            ${this.goals.length === 0 ? null : html`
              <button
                type="button"
                role="tab"
                id="drawer-tab-goals"
                class=${`drawer-tab drawer-tab-goals${tab === "goals" ? " selected" : ""}`}
                aria-selected=${String(tab === "goals")}
                tabindex=${tab === "goals" ? "0" : "-1"}
                aria-controls="session-goal-list"
                @click=${() => { this.selectTopDrawerTab("goals", collapsed); }}
              >
                <span class="drawer-tab-label">Goals ${this.goals.length}</span>
              </button>
            `}
          </div>
          </div>
          <div class="drawer-header-actions">
            ${tab === "notifications" && inbox !== undefined ? html`
              <button
                type="button"
                class="notification-control notification-clear"
                aria-label="Clear all notifications"
                title="Clear all notifications"
                ?disabled=${inbox.dismissAllPending || notificationCount === 0 || this.onDismissAllNotifications === undefined}
                @click=${() => { this.dismissAllNotifications(); }}
              >Clear</button>
            ` : null}
            <button
              type="button"
              class="notification-control notification-toggle drawer-toggle"
              aria-label=${toggleLabel}
              title=${toggleLabel}
              aria-expanded=${String(!collapsed)}
              aria-controls=${tab === "activity" ? "session-activity-list" : "session-notification-list"}
              @click=${() => { this.toggleTopDrawer(collapsed); }}
            >${renderNotificationDisclosureIcon(collapsed)}</button>
          </div>
        </header>
        <div class="drawer-body" ?hidden=${collapsed}>
          ${tab === "activity" && activity !== undefined ? this.renderActivityPanel(activity) : null}
          ${tab === "notifications" && inbox !== undefined ? this.renderNotificationPanel(inbox) : null}
          ${tab === "goals" && this.goals.length > 0 ? html`
            <div class="goal-drawer-panel" id="session-goal-list" role="tabpanel" aria-labelledby="drawer-tab-goals">
              <goal-panel
                .goals=${this.goals}
                ?canRunCommands=${true}
                .onRunCommand=${(goal: GoalRecordSummary, command: string) => this.onRunGoalCommand?.(goal, command)}
              ></goal-panel>
            </div>
          ` : null}
        </div>
      </section>
    `;
  }

  /** The inbox this chat should show, or undefined when there is nothing to show. */
  private visibleNotificationInbox(): SelectedSessionNotificationView | undefined {
    const inbox = this.notificationInbox;
    if (inbox?.sessionId !== this.sessionId) return undefined;
    const hasPendingOverlay = inbox.pendingDismissedIds.size > 0 || inbox.dismissAllPending;
    const retainsFocusTarget = this.retainedEmptyNotificationTrayTargetKey === notificationTargetKey(inbox);
    if (notificationInboxTotalCount(inbox) === 0 && !hasPendingOverlay && !retainsFocusTarget) return undefined;
    return inbox;
  }

  /**
   * Collapse and tab choice follow the exact chat, not just its session id, so
   * the same session id on another machine or cwd starts fresh.
   */
  private topDrawerKey(): string {
    const inbox = this.notificationInbox;
    return inbox?.sessionId === this.sessionId ? notificationTargetKey(inbox) : JSON.stringify([null, null, this.sessionId]);
  }

  /**
   * Folding is an explicit choice per chat, in both directions: the default
   * only decides what happens before the reader has said anything, and must
   * not overrule them later when a subagent happens to start.
   */
  private toggleTopDrawer(collapsed: boolean): void {
    const key = this.topDrawerKey();
    const collapsedKeys = new Set(this.collapsedTopDrawerKeys);
    const expandedKeys = new Set(this.expandedTopDrawerKeys);
    if (collapsed) {
      collapsedKeys.delete(key);
      expandedKeys.add(key);
    } else {
      expandedKeys.delete(key);
      collapsedKeys.add(key);
    }
    this.collapsedTopDrawerKeys = collapsedKeys;
    this.expandedTopDrawerKeys = expandedKeys;
  }

  /** Choosing a section is also how a folded drawer is opened on that section. */
  private selectTopDrawerTab(tab: TopDrawerTab, collapsed: boolean): void {
    this.topDrawerTab = tab;
    if (collapsed) this.toggleTopDrawer(collapsed);
  }

  /**
   * The subagents, tool runs and background tasks this session started.
   *
   * A parent conversation stays open while its children run; without this the
   * only way to see them was the agent tools' own output. Background tasks
   * share the list because they answer the same question a subagent row does -
   * what is this conversation running that is not the reply on screen - and a
   * browser had no other way to see them at all.
   */
  /**
   * Kind filter for the activity list.
   *
   * A long-running chat accumulates dozens of rows of three different kinds,
   * and "what are my subagents doing" and "did that build finish" are separate
   * questions. Kinds with nothing in them are not offered.
   */
  private renderActivityFilters(activity: ActivityPanelState, selected: ActivityFilter): TemplateResult | null {
    const options = activityFilterOptions(activity);
    if (options.length <= 1) return null;
    return html`
      <div class="activity-filters" role="group" aria-label="Filter session activity">
        ${options.map((option) => html`
          <button
            type="button"
            class=${`activity-filter activity-filter-${option.id}${option.id === selected ? " selected" : ""}`}
            aria-pressed=${String(option.id === selected)}
            @click=${() => { this.activityFilter = option.id; }}
          >${option.label} <span class="activity-filter-count">${String(option.count)}</span></button>
        `)}
      </div>
    `;
  }

  private activityPanelState(): ActivityPanelState | undefined {
    const subagents = this.subagents ?? [];
    const runs = this.subagentRuns ?? [];
    const tasks = this.backgroundTasks ?? [];
    if (subagents.length === 0 && runs.length === 0 && tasks.length === 0) return undefined;
    const rows = subagentRows(subagents);
    const runRows = subagentRunRows(runs);
    const taskRows = backgroundTaskRows(tasks);
    const summary = activityStripSummary([
      ...rows.map((row) => row.status),
      ...runRows.map((row) => row.status),
      ...taskRows.map((row) => row.status),
    ]);
    const activeCount = [...rows, ...runRows, ...taskRows].filter((row) => isActiveActivityStatus(row.status)).length;
    return { rows, runRows, taskRows, summary, total: rows.length + runRows.length + taskRows.length, activeCount };
  }

  private renderActivityPanel(activity: ActivityPanelState): TemplateResult {
    const filter = activityFilterInEffect(this.activityFilter, activity);
    const scope = activity.activeCount === 0 && this.activityScope === "active" ? "empty-active" : this.activityScope;
    const inFilter = orderActivityEntries([
      ...activity.rows.map((row, index): ActivityListEntry => ({ kind: "subagents", index, status: row.status, row })),
      ...activity.runRows.map((row, index): ActivityListEntry => ({ kind: "runs", index, status: row.status, startedAt: row.run.startedAt, row })),
      ...activity.taskRows.map((row, index): ActivityListEntry => ({ kind: "tasks", index, status: row.status, startedAt: row.task.startedAt, row })),
    ]).filter((entry) => filter === "all" || filter === entry.kind);
    const entries = inFilter.filter((entry) => scope === "all" || !isFinishedActivityStatus(entry.status));
    // Counted within the filter the reader is looking through: "Show 5 finished"
    // that reveals one row is a button that does not keep its word.
    const finished = inFilter.filter((entry) => isFinishedActivityStatus(entry.status)).length;
    return html`
      <div class="subagents-list" id="session-activity-list" role="tabpanel" aria-labelledby="drawer-tab-activity">
          ${this.renderActivityFilters(activity, filter)}
          ${scope === "empty-active"
            ? html`<p class="activity-empty">Nothing running right now.</p>`
            : null}
          ${repeat(entries, activityEntryKey, (entry) => this.renderActivityEntry(entry))}
          ${finished === 0 ? null : html`
            <button
              type="button"
              class="activity-history-toggle"
              aria-controls="session-activity-list"
              aria-expanded=${String(this.activityScope === "all")}
              @click=${(event: MouseEvent) => { this.toggleActivityScope(event.currentTarget); }}
            >${this.activityScope === "all" ? "Hide finished" : `Show ${String(finished)} finished`}</button>
          `}
      </div>
    `;
  }

  /** One row, in the shape its kind needs; the kind also labels it for a reader. */
  private renderActivityEntry(entry: ActivityListEntry): TemplateResult {
    if (entry.kind === "subagents") {
      const row = entry.row;
      return html`
        <button
          type="button"
          class="subagent-row status-${row.status}"
          title=${row.cwd}
          aria-label=${row.ariaLabel}
          @click=${() => { this.onOpenSubagent?.(row.subagent); }}
        >
          <span class="subagent-dot ${row.status}" aria-hidden="true"></span>
          <span class="subagent-kind" aria-hidden="true">Subagent</span>
          <span class="subagent-id" dir="ltr">${row.shortId}</span>
          <span class="subagent-status ${row.status}">${row.statusLabel}</span>
          <span class="subagent-chevron" aria-hidden="true">\u203a</span>
        </button>
      `;
    }
    if (entry.kind === "runs") {
      const row = entry.row;
      return html`
        <button
          type="button"
          class="subagent-row status-${row.status}"
          title=${row.run.task ?? row.run.agent}
          aria-label=${row.ariaLabel}
          @click=${() => { this.onOpenSubagentRun?.(row.run); }}
        >
          <span class="subagent-dot ${row.status}" aria-hidden="true"></span>
          <span class="subagent-kind" aria-hidden="true">Agent</span>
          <span class="subagent-id" dir="ltr">${row.run.agent}</span>
          ${row.modelLabel === undefined
            ? null
            : html`<span class="subagent-model" dir="ltr" title=${row.modelTitle ?? row.modelLabel}>${row.modelLabel}</span>`}
          <span class="subagent-status ${row.status}">${row.statusLabel}</span>
          <span class="subagent-duration">${row.duration}</span>
          <span class="subagent-chevron" aria-hidden="true">\u203a</span>
          ${row.detail === "" ? null : html`<span class="subagent-detail">${row.detail}</span>`}
        </button>
      `;
    }
    const row = entry.row;
    return html`
      <button
        type="button"
        class="subagent-row status-${row.status} background-task-row background-task-${String(entry.index)}"
        title=${row.task.command}
        aria-label=${row.ariaLabel}
        ?disabled=${!row.task.hasOutput}
        @click=${() => { this.onOpenBackgroundTask?.(row.task); }}
      >
        <span class="subagent-dot ${row.status}" aria-hidden="true"></span>
        <span class="subagent-kind" aria-hidden="true">Task</span>
        <span class="subagent-id" dir="ltr">${row.task.name}</span>
        <span class="subagent-status ${row.status}">${row.statusLabel}</span>
        <span class="subagent-duration">${row.duration}</span>
        ${row.task.hasOutput ? html`<span class="subagent-chevron" aria-hidden="true">\u203a</span>` : null}
        ${row.detail === "" ? null : html`<span class="subagent-detail" dir="ltr">${row.detail}</span>`}
      </button>
    `;
  }

  private renderNotificationPanel(inbox: SelectedSessionNotificationView): TemplateResult {
    return html`
        <div class="notification-list" id="session-notification-list" role="tabpanel" aria-labelledby="drawer-tab-notifications">
          ${inbox.discardedCount === 0 ? null : html`
            <p class="notification-overflow">${notificationInboxOverflowLabel(inbox.discardedCount)}</p>
          `}
          ${repeat(inbox.notifications, (notification) => notification.id, (notification) => {
            const label = notificationSeverityLabel(notification.severity);
            const truncationLabel = notificationMessageTruncationLabel(notification);
            return html`
              <article class=${`notification-row ${notification.severity}`} data-notification-id=${notification.id} tabindex="-1">
                <div class="notification-metadata">
                  <strong class="notification-severity">${label}</strong>
                  <span aria-hidden="true">·</span>
                  <time datetime=${notification.receivedAt}>${notificationTimestampFormatter.format(new Date(notification.receivedAt))}</time>
                </div>
                <p class="notification-message" dir="auto">${notification.message}</p>
                ${truncationLabel === undefined ? null : html`<p class="notification-truncated">${truncationLabel}</p>`}
                <div class="notification-row-actions">
                  <button
                    type="button"
                    class="notification-row-copy"
                    aria-label=${this.copiedNotificationId === notification.id ? "Message copied" : `Copy ${notificationSeverityLabel(notification.severity).toLowerCase()} message`}
                    title=${this.copiedNotificationId === notification.id ? "Copied" : "Copy message"}
                    @click=${() => { void this.copyNotification(notification); }}
                  ><span aria-hidden="true">${this.copiedNotificationId === notification.id ? "✓" : "⧉"}</span></button>
                  <button
                    type="button"
                    class="notification-row-dismiss"
                    aria-label=${notificationDismissLabel(notification)}
                    title="Dismiss notification"
                    ?disabled=${inbox.pendingDismissedIds.has(notification.id) || inbox.dismissAllPending || this.onDismissNotification === undefined}
                    @click=${() => { this.dismissNotification(notification.id); }}
                  >${renderNotificationCloseIcon()}</button>
                </div>
              </article>
            `;
          })}
        </div>
    `;
  }

  private renderNotificationLiveRegions() {
    const announcements = this.notificationInbox?.sessionId === this.sessionId ? this.notificationInbox.announcements : [];
    const polite = announcements.filter((announcement) => announcement.severity !== "error");
    const assertive = announcements.filter((announcement) => announcement.severity === "error");
    return html`
      <div class="visually-hidden notification-live" aria-live="polite" aria-atomic="false">${repeat(polite, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
      <div class="visually-hidden notification-live" aria-live="assertive" aria-atomic="false">${repeat(assertive, (announcement) => announcement.id, (announcement) => html`<span data-announcement-id=${announcement.id}>${notificationAnnouncementLabel(announcement)}</span>`)}</div>
    `;
  }

  private dismissNotification(notificationId: string): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissNotification === undefined) return;
    const focusTarget = notificationFocusTargetAfterDismiss(inbox.notifications, notificationId);
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget };
    if (focusTarget.kind === "header") this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissNotification(notificationId);
  }

  private dismissAllNotifications(): void {
    const inbox = this.notificationInbox;
    if (inbox === undefined || this.onDismissAllNotifications === undefined) return;
    const chatKey = notificationTargetKey(inbox);
    this.pendingNotificationFocus = { chatKey, focusTarget: { kind: "header" } };
    this.retainedEmptyNotificationTrayTargetKey = chatKey;
    this.onDismissAllNotifications();
  }

  private releaseEmptyNotificationTray(event: FocusEvent): void {
    const tray = event.currentTarget;
    const next = event.relatedTarget;
    if (tray instanceof HTMLElement && next instanceof Node && tray.contains(next)) return;
    // Removing the activated row can emit focusout before updated() moves focus.
    if (this.pendingNotificationFocus !== undefined) return;
    const inbox = this.notificationInbox;
    if (inbox !== undefined
      && this.retainedEmptyNotificationTrayTargetKey === notificationTargetKey(inbox)
      && notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = undefined;
  }

  private focusPendingNotificationTarget(): void {
    const pending = this.pendingNotificationFocus;
    this.pendingNotificationFocus = undefined;
    const inbox = this.notificationInbox;
    if (pending === undefined || inbox === undefined || notificationTargetKey(inbox) !== pending.chatKey) return;
    const target = pending.focusTarget;
    if (target.kind === "header") {
      this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
      return;
    }
    const row = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-notification-id]"))
      .find((candidate) => candidate.dataset["notificationId"] === target.notificationId);
    if (row !== undefined) {
      row.focus();
      return;
    }
    if (notificationInboxTotalCount(inbox) === 0) this.retainedEmptyNotificationTrayTargetKey = pending.chatKey;
    this.renderRoot.querySelector<HTMLElement>("[data-notification-focus='header']")?.focus();
  }

  private renderWarnings() {
    const rows = chatSessionWarningRows(this.status);
    if (!this.warningsVisible || rows.length === 0) return null;
    return html`
      <aside class="session-warnings" role="alert" aria-live="polite">
        ${this.onToggleWarnings === undefined ? null : html`
          <div class="session-warnings-controls">
            <button
              type="button"
              class="session-warnings-collapse"
              title="Minimise warnings"
              aria-label="Minimise warnings"
              @click=${this.handleToggleWarnings}
            >
              <svg class="session-warnings-collapse-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m18 15-6-6-6 6"></path>
              </svg>
              <span>Minimise</span>
            </button>
          </div>
        `}
        ${rows.map((row) => {
          const dismissId = row.dismissId;
          return html`
          <div class=${row.severityClass}>
            <div class="session-warning-head">
              ${renderSessionWarningIcon(row.severity, "session-warning-icon")}
              ${row.source === undefined ? null : html`<span class="session-warning-source">${row.source}</span>`}
            </div>
            <div class="session-warning-body">
              <p class="session-warning-message">${row.message}</p>
              ${row.path === undefined ? null : html`<p class="session-warning-path">${row.path}</p>`}
            </div>
            ${dismissId === undefined ? null : html`
              <button
                type="button"
                class="session-warning-dismiss"
                title="Don't show this warning again"
                aria-label="Dismiss warning"
                @click=${() => { this.onDismissWarning?.(dismissId); }}
              >×</button>
            `}
          </div>
        `;
        })}
      </aside>
    `;
  }

  private readonly closeActivityOutput = (): void => {
    if (this.activityOutput !== undefined) this.onCloseActivityOutput?.();
  };
  private readonly onActivityOutputDialogClick = (event: MouseEvent): void => {
    if (event.target === this.activityOutputDialog) this.closeActivityOutput();
  };

  private renderActivityOutput() {
    const output = this.activityOutput;
    return html`
      <dialog class="activity-output" @click=${this.onActivityOutputDialogClick} @close=${this.closeActivityOutput} @cancel=${this.closeActivityOutput}>
        ${output === undefined ? null : html`
          <header class="activity-output-head">
            <h2 class="activity-output-title">${output.title}</h2>
            <button type="button" class="activity-output-close" aria-label="Close output" @click=${this.closeActivityOutput}>×</button>
          </header>
          ${output.empty
            ? html`<p class="activity-output-empty">Nothing has been written to this log yet.</p>`
            : html`<pre class="activity-output-body">${output.text}</pre>`}
        `}
      </dialog>
    `;
  }

  private renderImageZoom() {
    return html`
      <dialog class="image-zoom" @click=${this.onImageZoomDialogClick} @close=${this.closeImageZoom} @cancel=${this.closeImageZoom}>
        ${this.zoomedImage === undefined ? null : html`
          <button type="button" class="image-zoom-close" aria-label="Close image" @click=${this.closeImageZoom}>×</button>
          <img class="image-zoom-full" src=${this.zoomedImage.src} alt=${this.zoomedImage.alt} />
        `}
      </dialog>
    `;
  }

  /**
   * Messages the server is still holding are not part of the conversation yet,
   * so they are kept out of the transcript and rendered in the pinned dock
   * instead. Once the agent takes one, the queue stops listing it, the bubble
   * loses its queued state here, and it joins the history in place - which is
   * the moment it actually became part of the conversation.
   */
  /**
   * The transcript renders every message it has, queued ones included.
   *
   * 1.202608.5-.7 kept queued messages out of it and showed them in a panel
   * pinned above the composer. On a phone that panel covered the conversation
   * it was supposed to annotate, and the version before that hid messages
   * outright when the state driving it went stale. A queued message is
   * therefore drawn where it always was - in place, marked - and the panel is
   * back to listing only what has no bubble here.
   */
  private transcriptMessages(): ChatLine[] {
    // Every queued message is drawn in the transcript - the server's, and the
    // ones this browser held while its session was still starting. Both carry
    // the same "queued" mark, so there is one home for a message in every
    // state. A separate panel used to repeat some of them and hide others,
    // which read as duplicate entries and missing ones on the same screen.
    return this.transcriptSplit().settled;
  }

  private transcriptSplit(): { settled: ChatLine[]; pending: ChatLine[] } {
    return splitTranscriptAndPending(this.messages, [...this.clientQueuedMessages, ...(this.status?.queuedMessages ?? [])]);
  }

  /**
   * Whether a status refresh added queued messages to the transcript.
   *
   * A message queued from another client shows up first in the status, and the
   * transcript row for it is drawn below the fold. Only a growth (or a change
   * while the queue is empty) should pull the view down after it; a status
   * polling tick that just re-reports the same queue must not.
   */
  private queueGrew(previousStatus: unknown): boolean {
    const previous = recordWithQueuedMessages(previousStatus);
    const was = previous?.queuedMessages?.length ?? 0;
    const now = (this.status?.queuedMessages ?? []).length;
    return now > was;
  }

  private groupedMessages(): ChatGroup[] {
    const source = this.transcriptMessages();
    if (this.groupedMessagesInput === source && this.groupedMessagesStart === this.messageStart) return this.groupedMessagesCache;
    // Streaming fast path: a pure append reuses the prefix group objects
    // (Lit skips re-templating them, the metadata cache keeps hitting) and
    // only re-groups the tail. Falls back to a full grouping otherwise.
    const previous = this.groupedMessagesInput;
    if (this.groupedMessagesStart === this.messageStart && previous !== undefined) {
      const appended = tryAppendGroupChatMessage(previous, this.groupedMessagesCache, source);
      if (appended !== undefined) {
        this.groupedMessagesInput = source;
        this.groupedMessagesCache = appended;
        return appended;
      }
    }
    this.groupedMessagesInput = source;
    this.groupedMessagesStart = this.messageStart;
    this.groupedMessagesCache = groupChatMessages(source, this.messageStart);
    return this.groupedMessagesCache;
  }

  private isLiveTailGroup(groups: ChatGroup[], index: number): boolean {
    return index === groups.length - 1 && this.isSessionLive();
  }

  private isSessionLive(): boolean {
    return this.isSendingPrompt
      || this.status?.isStreaming === true
      || this.status?.isCompacting === true
      || this.status?.isBashRunning === true
      || this.activity?.phase === "active";
  }

  /**
   * Keep the turn clock in step with the session's own state: it starts when
   * work starts, stops when the session goes quiet, and ticks only while the
   * dock is showing an elapsed time.
   */
  private syncTurnClock(): void {
    const working = this.isSessionLive();
    if (!working) {
      this.turnStartedAtMs = undefined;
      this.stopTurnClock();
      return;
    }
    this.turnStartedAtMs ??= Date.now();
    this.turnNowMs = Date.now();
    if (this.turnClockTimer !== undefined) return;
    this.turnClockTimer = window.setInterval(() => { this.turnNowMs = Date.now(); }, 1000);
  }

  private stopTurnClock(): void {
    if (this.turnClockTimer === undefined) return;
    window.clearInterval(this.turnClockTimer);
    this.turnClockTimer = undefined;
  }

  private renderActivityDock() {
    // An open question form owns the bottom of the screen; a floating status
    // pill there covers the field being typed into.
    if (this.pendingAsk !== undefined) return null;
    if (this.isSendingPrompt) {
      return html`
        <div class="activity-dock sending" aria-live="polite">
          <span class="state-dots"><span class="state-dot"></span><span class="state-dot"></span><span class="state-dot"></span></span>
          <span class="activity-text">Sending your message…</span>
        </div>
      `;
    }
    const state = this.activityState();
    if (state === undefined) return null;
    const category = this.activityCategory(state);
    // "idle" is about the assistant's own turn, and saying it while this chat's
    // subagents and background tasks are still running reads as "nothing is
    // happening" when something is.
    const background = backgroundWorkLabel(this.activityPanelState());
    const showBackground = background !== undefined && (category === "idle" || category === undefined);
    // Naming live background work and then ignoring a tap on it is a dead end:
    // the thing it names lives one control away, in the drawer.
    if (showBackground) {
      return html`
        <button
          type="button"
          class="activity-dock background"
          aria-live="polite"
          title="Show what this chat is running"
          @click=${() => { this.revealActivity(); }}
        >
          <span class="dot"></span>
          <span class="activity-text">${background}</span>
          <span class="subagent-chevron" aria-hidden="true">›</span>
        </button>
      `;
    }
    const elapsed = category === "working" ? turnElapsedLabel(this.turnStartedAtMs, this.turnNowMs) : undefined;
    return html`
      <div class=${`activity-dock ${category ?? ""}${elapsed?.long === true ? " long-running" : ""}`} aria-live="polite">
        ${category === "working"
          ? html`<span class="state-dots"><span class="state-dot"></span><span class="state-dot"></span><span class="state-dot"></span></span>`
          : html`<span class="dot"></span>`}
        <span class="activity-text">${activityDockLabel(category, state, this.activityText(state))}</span>
        ${elapsed === undefined ? null : html`<span class="activity-elapsed" aria-hidden="true">${elapsed.text}</span>`}
      </div>
    `;
  }

  /**
   * Give the screen back when the work the drawer was opened for ends.
   *
   * Opening the drawer used to be permanent, so a reader who opened it to
   * watch a subagent kept it open for the rest of the chat - on a tab left
   * open for days, always open, holding a block of screen to report that
   * nothing is running.
   */
  private foldDrawerAsWorkFinishes(): void {
    const working = this.activityPanelState()?.summary.working === true;
    const drop = dropsExpansionAsWorkFinishes({ wasWorking: this.drawerWorkWasRunning, working });
    this.drawerWorkWasRunning = working;
    if (!drop) return;
    const key = this.topDrawerKey();
    if (!this.expandedTopDrawerKeys.has(key)) return;
    const expandedKeys = new Set(this.expandedTopDrawerKeys);
    expandedKeys.delete(key);
    this.expandedTopDrawerKeys = expandedKeys;
  }

  /** Open the drawer on the running work the dock just named. */
  private revealActivity(): void {
    const key = this.topDrawerKey();
    const collapsedKeys = new Set(this.collapsedTopDrawerKeys);
    collapsedKeys.delete(key);
    const expandedKeys = new Set(this.expandedTopDrawerKeys);
    expandedKeys.add(key);
    this.collapsedTopDrawerKeys = collapsedKeys;
    this.expandedTopDrawerKeys = expandedKeys;
    this.topDrawerTab = "activity";
    // Scope, not filter: the reader asked to see what is running, not to have
    // their chosen kind thrown away.
    this.activityScope = "active";
  }

  /**
   * Delivery mark for a message this browser sent, in the corner of its own
   * bubble the way a messaging app reports a send. Messages loaded from history
   * carry no delivery state and stay unmarked: they arrived long ago, and a
   * transcript of check marks would be noise. A message the agent has taken
   * looks the same, so a bubble does not change appearance across a reload.
   */
  private renderDeliveryMark(message: ChatLine) {
    const delivery = message.meta?.delivery;
    if (!chatDeliveryMarkerVisible(delivery) || delivery === undefined) return null;
    const presentation = chatDeliveryPresentation(delivery);
    return html`
      <div class=${`delivery-mark ${presentation.tone}`} role="status" aria-label=${presentation.label}>
        <span class="delivery-glyph" aria-hidden="true">${presentation.glyph}</span>
        <span class="delivery-text">${presentation.text}</span>
      </div>
    `;
  }

  /**
   * Show or hide the finished rows, and keep the control that did it in view.
   *
   * It renders under the rows it reveals, so revealing them pushes it out of
   * the scrolling list: the reader taps "Show 5 finished" and the button they
   * just pressed is gone, with the keyboard focus left on something offscreen.
   */
  private toggleActivityScope(control: EventTarget | null): void {
    this.activityScope = this.activityScope === "all" ? "active" : "all";
    if (!(control instanceof HTMLElement)) return;
    void this.updateComplete.then(() => { control.scrollIntoView({ block: "nearest" }); });
  }

  /**
   * Arrow keys move between the drawer's tabs, which is what `role="tablist"`
   * promises a screen-reader user. Without it the role was a claim the widget
   * did not honour: the tabs were reachable only by tabbing through each one,
   * and a reader told "tab, 1 of 2" found the arrows did nothing.
   */
  private onDrawerTabsKeydown(event: KeyboardEvent): void {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const tabs = [...this.renderRoot.querySelectorAll<HTMLElement>(".drawer-tab")];
    if (tabs.length < 2) return;
    const current = tabs.findIndex((candidate) => candidate === event.target);
    if (current === -1) return;
    event.preventDefault();
    const next = tabs[(current + step + tabs.length) % tabs.length];
    next?.click();
    next?.focus();
  }

  private renderPendingMessages() {
    const pending = this.transcriptSplit().pending;
    if (pending.length === 0) return null;
    const base = this.messages.length;
    return html`${repeat(pending, (line, index) => this.messageAnchorKey(base + index), (line, index) => this.renderMessage(line, base + index))}`;
  }

  private renderQueuedMessages() {
    // Every queued message is drawn in the transcript, marked gold, so the only
    // thing a panel could add is a second listing of the same text. One action
    // still needs a home: clearing the whole server queue without stopping the
    // work it is waiting behind. A slim strip carries that, nothing more.
    const serverQueued = this.status?.queuedMessages ?? [];
    if (serverQueued.length === 0) return null;
    return html`
      <div class="queued-strip" aria-live="polite">
        <span class="queued-strip-count">${String(serverQueued.length)} queued</span>
        ${this.onClearServerQueue === undefined ? null : html`
          <button type="button" class="queued-clear-button" title="Clear queued messages without stopping active work" @click=${() => { this.onClearServerQueue?.(serverQueued); }}>Clear queue</button>
        `}
      </div>
    `;
  }

  private renderOpenAsk() {
    if (this.pendingAsk === undefined) return null;
    return html`
      <ask-user-card
        data-scroll-anchor-id=${`ask:${this.pendingAsk.askId}`}
        .ask=${this.pendingAsk}
        .draftSessionId=${this.askDraftSessionId}
        .onSubmit=${this.onSubmitAsk}
      ></ask-user-card>
    `;
  }

  private renderExtensionDialogs() {
    const open = this.pendingDialogs[0];
    if (open === undefined && this.closedDialogs.length === 0) return null;
    const queuedCount = this.pendingDialogs.length - 1;
    return html`
      ${repeat(
        this.closedDialogs,
        (closed) => closed.dialog.dialogId,
        (closed) => html`
          <extension-dialog-card
            class="closed-dialog-card"
            data-scroll-anchor-id=${`closed-dialog:${closed.dialog.dialogId}`}
            .outcome=${closed}
            .onDismiss=${this.onDismissClosedDialog}
          ></extension-dialog-card>
        `,
      )}
      ${open === undefined ? null : html`
        <extension-dialog-card
          class="open-dialog-card"
          data-scroll-anchor-id=${`dialog:${open.dialogId}`}
          .dialog=${open}
          .onAnswer=${this.onAnswerDialog}
          .onCancel=${this.onCancelDialog}
        ></extension-dialog-card>
        ${queuedCount > 0
          ? html`<p class="queued-dialogs" role="status">${String(queuedCount)} more extension ${queuedCount === 1 ? "dialog" : "dialogs"} queued</p>`
          : null}
      `}
    `;
  }

  private renderSessionActivity() {
    if (!this.isCompacting) return null;
    return html`
      <aside class="session-activity compacting" aria-live="polite">
        <strong>Compacting history…</strong>
        <span>The agent is summarizing earlier context. New prompts will be queued until compaction finishes.</span>
        ${this.pendingMessageCount > 0 ? html`<small>${this.pendingMessageCount} queued ${this.pendingMessageCount === 1 ? "message" : "messages"}</small>` : null}
      </aside>
    `;
  }

  private activityState(): string | undefined {
    const status = this.status;
    if (status === undefined) return this.activity?.label;
    if (status.isCompacting) return "compacting";
    if (status.isBashRunning) return "bash";
    if (status.isStreaming) return "running";
    if (status.pendingMessageCount > 0) return "queued";
    return "idle";
  }

  /**
   * Map the coarse dock state onto the shared four-state badge so the dock and
   * the session list rows agree: working (three dots), idle (green), asking
   * (amber, a question set or an extension dialog is waiting), error (red).
   */
  private activityCategory(state: string): SessionStateBadgeKind | undefined {
    if (this.activity?.phase === "error") return "error";
    if (state === "idle" || state === "undefined") {
      if (isWaitingForUser(this.status)) return "asking";
      return "idle";
    }
    if (isWaitingForUser(this.status)) return "asking";
    return "working";
  }

  private activityText(state: string): string {
    const activity = this.activity;
    if (activity === undefined) return state;
    if (state !== "idle" && activity.phase === "idle") return state;
    return activity.detail !== undefined && activity.detail !== "" ? `${activity.label}: ${activity.detail}` : activity.label;
  }

  private renderConversationRail() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const total = this.conversationDisplayTotal();
    const position = this.conversationPositionPercent(total);
    const loadedPercent = this.hasMore ? clampPercent((this.messages.length / total) * 100) : 100;
    return html`<conversation-meter .positionPercent=${position} .loadedPercent=${loadedPercent}></conversation-meter>`;
  }

  private conversationDisplayTotal(): number {
    if (!this.hasMore && this.messageStart === 0) return Math.max(1, this.messages.length);
    return Math.max(1, this.messageTotal, this.messageStart + this.messages.length);
  }

  private conversationPositionPercent(total = this.conversationDisplayTotal()): number {
    if (total <= 1) return 100;
    const fallbackIndex = this.pinnedToBottom ? this.messageStart + this.messages.length - 1 : this.messageStart;
    const index = clampNumber(this.currentConversationIndex ?? fallbackIndex, 0, total - 1);
    return clampPercent((index / (total - 1)) * 100);
  }

  private renderHistoryBoundary() {
    const range = this.historyRangeLabel();
    if (this.loadingMore) return html`<div class="history-boundary"><span>Loading earlier messages…</span>${range}</div>`;
    if (this.hasMore) return html`
      <div class="history-boundary">
        <button type="button" class="history-load-button" ?disabled=${this.loadMoreRequested} @click=${() => { this.requestLoadMore(); }}>Load earlier messages</button>
        <span>Scroll up to load earlier messages</span>
        ${range}
      </div>
    `;
    if (this.messages.length) return html`<div class="history-boundary"><span>Beginning of session</span>${range}</div>`;
    return this.renderEmptySession();
  }

  /**
   * What a session with nothing in it says for itself.
   *
   * Rendering nothing left roughly 1160px of blank screen between the header
   * and the composer, which reads the same as a session that failed to load.
   * An empty session is a normal state with an obvious next step, so it says
   * which one it is and points at the composer.
   */
  private renderEmptySession() {
    if (this.loadingMore) return null;
    return html`
      <div class="empty-session" role="status">
        <p>This session is empty. Send a message to start it.</p>
        ${this.onFocusComposer === undefined
          ? null
          : html`<button type="button" @click=${() => { this.onFocusComposer?.(); }}>Write the first message</button>`}
      </div>
    `;
  }

  private historyRangeLabel() {
    if (!this.messages.length || this.messageTotal <= 0) return null;
    const from = this.messageStart + 1;
    const to = this.loadedRawMessageEnd();
    const total = Math.max(this.messageTotal, to);
    return html`<small>Showing messages ${from}–${to} of ${total}</small>`;
  }

  private loadedRawMessageEnd(): number {
    return Math.max(this.messageEnd, this.messageStart + this.messages.length);
  }

  private renderMessage(message: ChatLine, index: number) {
    const toolOnly = this.isToolExecutionOnlyMessage(message);
    const askUserRecordOnly = this.isAskUserRecordOnlyMessage(message);
    const shellClass = toolOnly ? "msg tool-execution-shell" : "msg ask-user-record-shell";
    // A message the server is still holding is not part of the conversation
    // yet, and it should not look like one that is. It carries the pending
    // colour until the agent takes it, then becomes an ordinary user message -
    // which is also the moment the recall action stops being offered, so the
    // colour and the affordance say the same thing.
    const queuedClass = this.isQueuedLine(message) ? " queued" : "";
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class=${toolOnly || askUserRecordOnly ? shellClass : `msg ${message.role}${queuedClass}`} data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${toolOnly || askUserRecordOnly ? null : this.renderMessageHeader(message, String(index))}
        ${message.parts.map((part) => this.renderPart(part, message))}
        ${this.renderDeliveryMark(message)}
      </article>
    `;
  }

  private renderToolImageOutput(message: ChatLine, index: number, toolName?: string) {
    const label = chatToolOutputLabel(toolName);
    return html`
      ${this.renderScrollMarker(this.messageScrollMarkerId(index))}
      <article class="msg tool-image-output" data-index=${index} data-scroll-anchor-id=${this.messageAnchorKey(index)}>
        ${this.renderMessageHeader(message, String(index), label)}
        ${message.parts.map((part) => this.renderPart(part, message))}
      </article>
    `;
  }

  private isToolExecutionOnlyMessage(message: ChatLine): boolean {
    return message.role === "tool" && message.parts.length > 0 && message.parts.every((part) => part.type === "toolExecution");
  }

  private isAskUserRecordOnlyMessage(message: ChatLine): boolean {
    return message.parts.length > 0 && message.parts.every((part) => part.type === "askUserRecord");
  }

  private renderMessageGroup(messages: ChatLine[], startIndex: number, endIndex: number, defaultOpen: boolean) {
    const disclosureKey = this.groupDisclosureKey(startIndex, endIndex, defaultOpen);
    const open = this.disclosures.isOpen(disclosureKey, defaultOpen);
    return html`
      ${this.renderScrollMarker(this.groupScrollMarkerId(endIndex))}
      <details class=${chatMessageGroupClassName(defaultOpen)} data-index=${startIndex} data-scroll-anchor-id=${this.groupAnchorKey(startIndex)} ?open=${open} @toggle=${(event: Event) => { this.onGroupToggle(disclosureKey, event, defaultOpen); }}>
        <summary>
          <b class="label">${chatMessageGroupLabel(defaultOpen)}</b>
          <span>${summarizeChatGroup(messages)}</span>
        </summary>
        ${open ? this.renderMessageGroupBody(messages, startIndex) : null}
      </details>
    `;
  }

  private renderMessageGroupBody(messages: ChatLine[], startIndex: number) {
    return html`
      <div class="group-body">
        ${messages.map((message, offset) => {
          const toolOnly = this.isToolExecutionOnlyMessage(message);
          return html`
            <section class=${toolOnly ? "group-msg tool-execution-shell" : `group-msg ${message.role}`} data-index=${startIndex + offset} data-scroll-anchor-id=${this.eventAnchorKey(startIndex + offset)}>
              ${toolOnly ? null : this.renderMessageHeader(message, `${String(startIndex)}:${String(offset)}`)}
              ${message.parts.map((part) => this.renderPart(part, message))}
            </section>
          `;
        })}
      </div>
    `;
  }

  private renderScrollMarker(markerId: string) {
    return html`<span class="scroll-marker" data-marker-id=${markerId} aria-hidden="true"></span>`;
  }

  private renderMessageHeader(message: ChatLine, key: string, label: string = message.role) {
    const meta = this.messageMetaLabel(message);
    const expanded = this.expandedMetaKey === key;
    return html`
      <div class="msg-header">
        <b class="label">${label}</b>
        <div class="msg-header-trailing">
          ${this.renderMessageActions(message, key)}
          ${meta === "" ? null : html`<span class=${expanded ? "msg-meta expanded" : "msg-meta"} role="button" tabindex="0" title=${meta} aria-label=${meta} aria-expanded=${String(expanded)} @click=${() => { this.expandedMetaKey = expanded ? undefined : key; }} @keydown=${(event: KeyboardEvent) => { this.onMetaKeydown(event, key, expanded); }}>${meta}</span>`}
        </div>
      </div>
    `;
  }

  /**
   * The queue entry for a bubble, when the server still has one.
   *
   * Everything about a queued message keys off this: its colour, its recall
   * action, and the moment both stop applying. It reads the server's queue
   * rather than the bubble's own delivery state, which can go stale - a
   * message the queue has released must not keep either.
   */
  private queueEntryFor(line: ChatLine): QueuedSessionMessage | undefined {
    const clientMessageId = line.meta?.delivery?.clientMessageId;
    if (clientMessageId === undefined) return undefined;
    const queued = this.status?.queuedMessages ?? [];
    const byId = queued.find((message) => message.clientMessageId === clientMessageId);
    if (byId !== undefined) return byId;
    // A message queued by another client or a non-browser caller has no id, so
    // the synthesized row keys itself as `queued:kind:text`. The server recalls
    // such entries by kind+text, so match the same way instead of treating the
    // row as an ordinary user message.
    const fallback = /^queued:([^:]+):(.*)$/.exec(clientMessageId);
    if (fallback === null) return undefined;
    const [, kind, text] = fallback;
    return queued.find((message) => message.kind === kind && message.text === text);
  }

  private isQueuedLine(line: ChatLine): boolean {
    return this.queueEntryFor(line) !== undefined;
  }

  /** The queued bubble's own recall action; see renderQueuedMessages. */
  private renderQueuedBubbleRecall(line: ChatLine) {
    if (this.onRecallQueuedMessage === undefined) return null;
    const queued = this.queueEntryFor(line);
    if (queued === undefined) return null;
    // data-action, not a styling class: the hook has to survive the button
    // being restyled, which is exactly what broke its test once already.
    return html`<button type="button" class="msg-action" data-action="recall" title="Recall: take this message back and put it in the composer" aria-label="Recall this queued message into the composer" @click=${() => { this.onRecallQueuedMessage?.(queued); }}>
      <span aria-hidden="true">↩</span>
    </button>`;
  }

  private renderMessageActions(message: ChatLine, key: string) {
    const resendable = this.onResendMessage !== undefined && isResendableLine(message);
    const recall = this.renderQueuedBubbleRecall(message);
    if (!this.isCopyableMessage(message) && !resendable && recall === null) return null;
    const copied = this.copiedMessageKey === key;
    return html`
      <div class="msg-actions" aria-label="Message actions">
        ${recall}
        ${resendable
          ? html`<button type="button" class="msg-action" title="Edit and send again" aria-label="Put this message back in the composer to send again" @click=${(event: MouseEvent) => { this.resendMessage(message, event); }}>
              <span aria-hidden="true">↻</span>
            </button>`
          : null}
        ${this.isCopyableMessage(message)
          ? html`<button type="button" class="msg-action" title=${copied ? "Copied" : "Copy message"} aria-label=${`${copied ? "Copied" : "Copy"} ${message.role} message`} @click=${(event: MouseEvent) => { void this.copyMessage(message, key, event); }}>
              <span aria-hidden="true">${copied ? "✓" : "⧉"}</span>
            </button>`
          : null}
      </div>
    `;
  }

  /**
   * Hand the prompt back to the composer rather than sending it straight away:
   * the previous attempt failed, and the user usually wants to change the model
   * or the wording before trying again.
   */
  private resendMessage(message: ChatLine, event: MouseEvent): void {
    event.stopPropagation();
    const recovered = recoverPromptFromLine(message);
    if (recovered === undefined) return;
    void this.onResendMessage?.(recovered);
  }

  private onMetaKeydown(event: KeyboardEvent, key: string, expanded: boolean) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.expandedMetaKey = expanded ? undefined : key;
  }

  private isCopyableMessage(message: ChatLine): boolean {
    return (message.role === "user" || message.role === "assistant") && this.messageCopyText(message) !== "";
  }

  private messageCopyText(message: ChatLine): string {
    const cached = this.messageCopyTextCache.get(message);
    if (cached !== undefined) return cached;
    const text = message.parts
      .filter((part): part is Extract<ChatPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text.trim())
      .filter((partText) => partText !== "")
      .join("\n\n");
    this.messageCopyTextCache.set(message, text);
    return text;
  }

  /**
   * Put a notification's message on the clipboard.
   *
   * The message alone, without the severity or timestamp shown beside it: what
   * gets pasted into a bug report or a search box should be what went wrong.
   * A notification is often the only place that detail exists, and taking it by
   * drag-selecting wrapped lines inside a scrolling list is painful on a phone,
   * where the drag fights the scroll.
   */
  private async copyNotification(notification: SessionNotification): Promise<void> {
    if (!await writeClipboardText(notification.message)) return;
    const id = notification.id;
    this.copiedNotificationId = id;
    // Plain setTimeout, not window.setTimeout: the tray renders in environments
    // that have timers but no window object.
    setTimeout(() => {
      if (this.copiedNotificationId === id) this.copiedNotificationId = undefined;
    }, 1200);
  }

  private async copyMessage(message: ChatLine, key: string, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const copied = await writeClipboardText(this.messageCopyText(message));
    if (!copied) return;
    this.copiedMessageKey = key;
    window.setTimeout(() => {
      if (this.copiedMessageKey === key) this.copiedMessageKey = undefined;
    }, 1200);
  }


  private messageMetaLabel(message: ChatLine): string {
    const cached = this.messageMetaCache.get(message);
    if (cached !== undefined) return cached;
    const label = chatMessageMetadataLabel(message);
    this.messageMetaCache.set(message, label);
    return label;
  }

  private renderPart(part: ChatPart, message?: ChatLine) {
    if (part.type === "text" && message?.role === "bash") return html`<pre class="part shell-output">${part.text}</pre>`;
    if (part.type === "text") return html`<formatted-text class="part" .text=${part.text}></formatted-text>`;
    if (part.type === "thinking") return html`<details class="part"><summary>thinking</summary><formatted-text .text=${part.text}></formatted-text></details>`;
    if (part.type === "skillInvocation") return html`
      <details class="part skill-invocation">
        <summary><b>[skill]</b> ${part.name}</summary>
        <small>${part.location}</small>
        <formatted-text .text=${part.content}></formatted-text>
      </details>
    `;
    if (part.type === "skillRead") return html`
      <div class="part skill-read">
        <strong>Loaded ${part.name}</strong>
        <small>read ${part.path}</small>
      </div>
    `;
    if (part.type === "askUserRecord") return html`
      <ask-user-card
        class="part"
        .outcome=${part.outcome}
        .draftSessionId=${this.askDraftSessionId}
      ></ask-user-card>
    `;
    if (part.type === "image") {
      const { src, alt } = chatImagePartSource(part);
      return html`<img class="part chat-image" src=${src} alt=${alt} loading="lazy" role="button" tabindex="0" title="Click to enlarge" @load=${this.onImageLoad} @click=${() => { this.openImageZoom(src, alt); }} @keydown=${(event: KeyboardEvent) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.openImageZoom(src, alt); } }} />`;
    }
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolExecution") return html`<tool-execution-view class="part" .execution=${part}></tool-execution-view>`;
    if (part.type === "toolResult") return html`
      <details class="part" ?open=${part.isError}>
        <summary>${part.isError ? "✖" : "✓"} ${part.toolName} result</summary>
        <formatted-text .text=${part.text}></formatted-text>
      </details>
    `;
    return null;
  }

  private onGroupToggle(key: string, event: Event, defaultOpen: boolean) {
    const details = event.currentTarget;
    if (!(details instanceof HTMLDetailsElement)) return;
    if (this.disclosures.applyToggle(key, details.open, defaultOpen)) this.requestUpdate();
  }

  private onScroll() {
    this.requestLoadMoreIfNeeded();
    this.updatePinnedToBottomFromScroll();
    this.scheduleConversationRailUpdate();
    if (!this.suppressScrollSave) this.scheduleScrollPositionSave();
  }

  private onWheel(event: WheelEvent) {
    if (event.deltaY < 0 && this.canScrollUp()) this.pinnedToBottom = false;
  }

  private onTouchStart(event: TouchEvent) {
    this.touchStartY = event.touches[0]?.clientY;
    this.followGate.notePointerDown(Date.now());
  }

  private onTouchEnd(): void {
    this.followGate.notePointerUp(Date.now());
  }

  private onTouchMove(event: TouchEvent) {
    const y = event.touches[0]?.clientY;
    if (this.touchStartY !== undefined && y !== undefined && y > this.touchStartY && this.canScrollUp()) this.pinnedToBottom = false;
  }

  private updatePinnedToBottomFromScroll() {
    const chat = this.chat;
    if (!chat) return;
    const heightChanged = this.didChatHeightChange();
    const wasPinnedToBottom = this.pinnedToBottom;
    const scrollingUp = chat.scrollTop < this.lastScrollTop;
    if (heightChanged && wasPinnedToBottom) {
      this.lastClientHeight = chat.clientHeight;
      this.scrollToBottom();
      return;
    }
    if (this.isAtBottom()) this.pinnedToBottom = true;
    else if (scrollingUp) this.pinnedToBottom = false;
    else this.pinnedToBottom = this.isNearBottom();
    this.jumpToBottomVisible = showsJumpToBottom(chat);
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
  }

  private didChatHeightChange(): boolean {
    const chat = this.chat;
    return chat !== undefined && this.lastClientHeight !== 0 && chat.clientHeight !== this.lastClientHeight;
  }

  private isPrependingMessages(changed: Map<string, unknown>): boolean {
    const oldMessageStart = changed.get("messageStart");
    return typeof oldMessageStart === "number" && this.messageStart < oldMessageStart;
  }

  private requestLoadMoreIfNeeded(): void {
    if (this.loadMoreCheckFrame !== undefined) return;
    this.loadMoreCheckFrame = requestAnimationFrame(() => {
      this.loadMoreCheckFrame = undefined;
      if (this.suppressLoadMoreRequests) return;
      const chat = this.chat;
      if (!chat) return;
      if (shouldRequestEarlierMessages({
        hasMore: this.hasMore,
        loadingMore: this.loadingMore || this.loadMoreRequested,
        canRequest: this.onLoadMore !== undefined,
        scrollTop: chat.scrollTop,
        scrollHeight: chat.scrollHeight,
        clientHeight: chat.clientHeight,
      })) this.requestLoadMore();
    });
  }

  private requestLoadMore(): void {
    if (this.loadMoreRequested) return;
    if (!this.hasMore || this.loadingMore || this.onLoadMore === undefined) return;
    this.loadMoreRequested = true;
    this.onLoadMore();
  }

  private isNearBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return isNearScrollBottom(chat);
  }

  private isAtBottom(): boolean {
    const chat = this.chat;
    if (!chat) return true;
    return distanceFromScrollBottom(chat) < 2;
  }

  private canScrollUp(): boolean {
    const chat = this.chat;
    return chat !== undefined && chat.scrollTop > 0;
  }

  private scrollToBottom() {
    if (this.scrollToBottomFrame !== undefined) return;
    this.scrollToBottomFrame = requestAnimationFrame(() => {
      this.scrollToBottomFrame = undefined;
      const chat = this.chat;
      if (!chat) return;
      if (!this.followGate.followsNewest(Date.now())) return;
      this.withSuppressedScrollSave(() => {
        chat.scrollTop = chat.scrollHeight;
        this.lastScrollTop = chat.scrollTop;
        this.lastClientHeight = chat.clientHeight;
      });
    });
  }

  private isNewPendingAsk(previous: unknown): boolean {
    return this.pendingAsk !== undefined
      && (typeof previous !== "object" || previous === null || Reflect.get(previous, "askId") !== this.pendingAsk.askId);
  }

  private isNewOpenDialog(previous: unknown): boolean {
    const oldest = this.pendingDialogs[0];
    if (oldest === undefined) return false;
    if (!Array.isArray(previous)) return true;
    const previousOldest: unknown = previous[0];
    return typeof previousOldest !== "object" || previousOldest === null || Reflect.get(previousOldest, "dialogId") !== oldest.dialogId;
  }

  private scrollToOpenAsk(): void {
    if (this.scrollToOpenAskFrame !== undefined) return;
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.scrollToOpenAskFrame = requestAnimationFrame(() => {
      this.scrollToOpenAskFrame = undefined;
      this.withSuppressedScrollSave(() => { this.alignOpenAskToTop(); });
    });
  }

  private alignOpenAskToTop(): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(".chat > ask-user-card");
    if (chat === undefined || card === null) return false;
    chat.scrollTop += card.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    this.syncScrollMetrics();
    this.pinnedToBottom = this.isNearBottom();
    return true;
  }

  private scrollToOpenDialog(): void {
    if (this.scrollToOpenDialogFrame !== undefined) return;
    if (this.scrollToBottomFrame !== undefined) {
      cancelAnimationFrame(this.scrollToBottomFrame);
      this.scrollToBottomFrame = undefined;
    }
    this.scrollToOpenDialogFrame = requestAnimationFrame(() => {
      this.scrollToOpenDialogFrame = undefined;
      this.withSuppressedScrollSave(() => { this.alignOpenDialogToTop(); });
    });
  }

  private alignOpenDialogToTop(): boolean {
    const chat = this.chat;
    const card = this.renderRoot.querySelector<HTMLElement>(".chat > extension-dialog-card.open-dialog-card");
    if (chat === undefined || card === null) return false;
    chat.scrollTop += card.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    this.syncScrollMetrics();
    this.pinnedToBottom = this.isNearBottom();
    return true;
  }

  restoreScrollPosition() {
    const sessionId = this.sessionId;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        if (this.pendingAsk !== undefined && this.scrollController.readPosition(sessionId) === undefined && this.alignOpenAskToTop()) return;
        if (this.pendingDialogs.length > 0 && this.scrollController.readPosition(sessionId) === undefined && this.alignOpenDialogToTop()) return;
        const result = this.scrollController.restorePosition(sessionId, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result);
      });
    });
  }

  private continuePendingScrollRestore(): void {
    const sessionId = this.pendingScrollRestoreSessionId;
    const position = this.pendingScrollRestorePosition;
    if (sessionId === undefined || position === undefined || sessionId !== this.sessionId || this.restoreScrollFrame !== undefined) return;
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        const result = this.scrollController.restoreExplicitPosition(position, this.chat, this.scrollAnchorElements(), { fallbackToBottom: this.shouldFallbackToBottomForMissingAnchor() });
        this.handleScrollRestoreResult(sessionId, result);
      });
    });
  }

  private handleScrollRestoreResult(sessionId: string, result: ChatScrollRestoreResult): void {
    this.syncScrollMetrics();
    if (result.status !== "missing") {
      this.updatePinnedToBottomAfterRestore(result.status);
      if (result.status === "restored" || result.status === "bottom") this.cancelPrependRestore();
      this.pendingScrollRestoreSessionId = undefined;
      this.pendingScrollRestorePosition = undefined;
      return;
    }

    this.pinnedToBottom = false;
    this.pendingScrollRestoreSessionId = sessionId;
    this.pendingScrollRestorePosition = result.position;
    const chat = this.chat;
    if (chat === undefined || !this.hasMore || this.loadingMore) return;
    chat.scrollTop = 0;
    this.syncScrollMetrics();
    this.requestLoadMore();
  }

  private shouldFallbackToBottomForMissingAnchor(): boolean {
    // Only fall back to the bottom once the full history is loaded; while earlier
    // pages can still load, a missing scroll anchor should keep retrying rather
    // than jump the user to the bottom.
    return !this.hasMore;
  }

  private updatePinnedToBottomAfterRestore(status: Exclude<ChatScrollRestoreResult["status"], "missing">): void {
    if (status === "bottom") this.pinnedToBottom = true;
    else if (status === "restored") this.pinnedToBottom = this.isNearBottom();
  }

  private syncScrollMetrics(): void {
    const chat = this.chat;
    if (chat === undefined) return;
    this.lastScrollTop = chat.scrollTop;
    this.lastClientHeight = chat.clientHeight;
  }

  private cancelPrependRestore(): void {
    this.prependRestoreToken += 1;
    this.suppressLoadMoreRequests = false;
  }

  capturePrependScrollAnchor(): PrependScrollAnchor | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    return capturePrependScrollAnchor(chat, this.scrollMarkers());
  }

  restorePrependScrollAnchor(anchor: PrependScrollAnchor | undefined): void {
    if (!this.chat || !anchor) return;
    this.suppressLoadMoreRequests = true;
    this.suppressScrollSave = true;
    const token = this.prependRestoreToken + 1;
    this.prependRestoreToken = token;
    let frames = 0;
    const settle = () => {
      const chat = this.chat;
      if (!chat || token !== this.prependRestoreToken) return;
      restorePrependScrollAnchor(chat, anchor, anchor.markerId === undefined ? undefined : this.scrollMarkerAt(anchor.markerId));
      this.lastScrollTop = chat.scrollTop;
      frames += 1;
      // Formatted markdown/code layout can settle after Lit's first render. Re-apply
      // the marker anchor briefly so late height changes above the viewport do not
      // move the user's reading position.
      if (frames < PREPEND_RESTORE_SETTLE_FRAMES) {
        requestAnimationFrame(settle);
        return;
      }
      requestAnimationFrame(() => {
        if (token !== this.prependRestoreToken) return;
        this.suppressScrollSave = false;
        this.suppressLoadMoreRequests = false;
      });
    };
    settle();
  }

  saveScrollPosition(sessionId = this.sessionId) {
    if (!sessionId) return;
    this.scrollController.savePosition(sessionId, this.chat, this.scrollAnchorElements());
  }

  private scheduleScrollPositionSave() {
    const sessionId = this.sessionId;
    this.scrollController.scheduleSave(sessionId, (scheduledSessionId) => {
      if (this.sessionId === scheduledSessionId) this.saveScrollPosition(scheduledSessionId);
    });
  }

  private scheduleConversationRailUpdate(): void {
    if (this.conversationRailFrame !== undefined) return;
    this.conversationRailFrame = requestAnimationFrame(() => {
      this.conversationRailFrame = undefined;
      this.updateConversationRailPosition();
    });
  }

  private updateConversationRailPosition(): void {
    if (!this.messages.length || this.messageTotal <= 0) {
      this.currentConversationIndex = undefined;
      return;
    }
    const total = this.conversationDisplayTotal();
    const article = this.firstVisibleArticle();
    const index = Number(article?.dataset["index"]);
    if (Number.isFinite(index)) {
      this.currentConversationIndex = clampNumber(index, 0, Math.max(0, total - 1));
      return;
    }
    this.currentConversationIndex = clampNumber(this.pinnedToBottom ? this.messageStart + this.messages.length - 1 : this.messageStart, 0, Math.max(0, total - 1));
  }

  private scrollMarkers(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>(".scroll-marker"));
  }

  private scrollMarkerAt(markerId: string): HTMLElement | undefined {
    return this.scrollMarkers().find((marker) => marker.dataset["markerId"] === markerId);
  }

  private firstVisibleArticle(): HTMLElement | undefined {
    const chat = this.chat;
    if (chat === undefined) return undefined;
    const primaryArticles = Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg"));
    return findFirstVisibleArticle(chat, primaryArticles) ?? findFirstVisibleArticle(chat, this.articles());
  }

  private articles(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("article.msg, details.msg"));
  }

  private scrollAnchorElements(): HTMLElement[] {
    return Array.from(this.renderRoot.querySelectorAll<HTMLElement>("[data-scroll-anchor-id]"));
  }

  private withSuppressedScrollSave(callback: () => void) {
    this.suppressScrollSave = true;
    callback();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        this.suppressScrollSave = false;
      });
    });
  }

  private groupDisclosureKey(startIndex: number, endIndex: number, defaultOpen: boolean): string {
    return defaultOpen ? `${this.sessionId}:live:${String(startIndex)}` : `${this.sessionId}:${String(endIndex)}`;
  }

  private messageAnchorKey(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private groupRenderKey(startIndex: number): string {
    return chatGroupAnchorKey(startIndex);
  }

  private groupAnchorKey(startIndex: number): string {
    return chatGroupAnchorKey(startIndex);
  }

  private eventAnchorKey(index: number): string {
    return chatEventAnchorKey(index);
  }

  private messageScrollMarkerId(index: number): string {
    return chatMessageAnchorKey(index);
  }

  private groupScrollMarkerId(endIndex: number): string {
    return chatGroupScrollMarkerId(endIndex);
  }

  static override styles = chatStyles;
}

/**
 * Row fields for the subagents strip, derived once so the presentation layer
 * stays a dumb map and the shape is testable directly (mirrors
 * chatSessionWarningRows).
 */
export interface SubagentRow {
  subagent: SessionSubagentInfo;
  shortId: string;
  status: SessionSubagentInfo["status"];
  /** "Working"/"idle"/"error"/"unknown": the word shown in the strip. */
  statusLabel: string;
  cwd: string;
  ariaLabel: string;
}

/** How long a run has been going, in the shortest form that stays readable. */
export function subagentRunDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

export interface SubagentRunRow {
  run: SessionSubagentRunInfo;
  status: SessionSubagentRunInfo["status"];
  statusLabel: string;
  duration: string;
  detail: string;
  /** Model and thinking level, when the run recorded what it ran on. */
  modelLabel?: string;
  modelTitle?: string;
  ariaLabel: string;
}

/**
 * A row per subagent-tool run. The detail line answers the question the list
 * exists for: a running child shows the step it is on, a finished one shows
 * what it was asked to do, because that is what makes its output worth opening.
 */
export function subagentRunRows(runs: readonly SessionSubagentRunInfo[]): SubagentRunRow[] {
  return runs.map((run) => {
    const statusLabel = run.status === "running" ? "Running" : run.status === "done" ? "Done" : run.status === "failed" ? "Failed" : run.status === "lost" ? "Lost" : "Unknown";
    const duration = subagentRunDuration(run.elapsedMs);
    const detail = run.status === "running" ? run.lastActivity ?? "working" : run.task ?? "";
    const model = describeRunModel(run.model);
    return {
      run,
      // Losing track of a run is the reader losing information, not the run
      // failing; it is reported as what it is.
      status: run.status,
      statusLabel,
      duration,
      detail,
      ...(model === undefined ? {} : { modelLabel: model.label, modelTitle: run.model ?? model.label }),
      ariaLabel: `${statusLabel} ${run.agent} subagent, ${duration}`
        + (model === undefined ? "" : `, on ${model.label}`)
        + (detail === "" ? "" : `, ${detail}`),
    };
  });
}

/** What a piece of background work is doing, in the words the drawer uses. */
export type ActivityStatus = "running" | "working" | "idle" | "done" | "failed" | "error" | "stopped" | "lost" | "unknown";

export interface BackgroundTaskRow {
  task: SessionBackgroundTaskInfo;
  /** Collapsed to the three states a strip can show, from the tool's larger vocabulary. */
  status: ActivityStatus;
  statusLabel: string;
  duration: string;
  detail: string;
  ariaLabel: string;
}

/**
 * The task tool reports more statuses than a one-line strip can show, and
 * "lost" is one this reader adds for a running record whose process is gone.
 * They collapse onto the three the subagent rows already use, so the strip
 * stays readable and the styling is shared.
 */
export function backgroundTaskRows(tasks: readonly SessionBackgroundTaskInfo[]): BackgroundTaskRow[] {
  return tasks.map((task) => {
    // Stopping a task is something the reader did on purpose, and losing track
    // of one is not the task failing. Counting either as a failure taught the
    // reader to ignore a count that said dozens had failed when none had.
    const status = task.status === "running" ? "running"
      : task.status === "completed" ? "done"
      : task.status === "killed" ? "stopped"
      : task.status === "failed" ? "failed"
      : task.status === "lost" ? "lost"
      : "unknown";
    const statusLabel = task.status === "completed" ? "Done"
      : task.status === "running" ? "Running"
      : task.status === "killed" ? "Stopped"
      : task.status === "lost" ? "Lost"
      : task.status.charAt(0).toUpperCase() + task.status.slice(1);
    const duration = subagentRunDuration(task.durationMs ?? 0);
    // While it runs the command is what someone wants to see; once it is done
    // the exit code is, because that is the question they came back to answer.
    const detail = status === "running"
      ? task.command.slice(0, 60)
      : task.exitCode === undefined ? "" : `exit ${String(task.exitCode)}`;
    return {
      task,
      status,
      statusLabel,
      duration,
      detail,
      ariaLabel: `${statusLabel} background task ${task.name}, ${duration}${detail === "" ? "" : `, ${detail}`}`,
    };
  });
}

export type TopDrawerTab = "activity" | "notifications" | "goals";

/** One row of the activity list, tagged with the kind its filter chip names. */
export type ActivityListEntry =
  | { kind: "subagents"; index: number; status: ActivityStatus; startedAt?: string | undefined; row: SubagentRow }
  | { kind: "runs"; index: number; status: ActivityStatus; startedAt?: string | undefined; row: SubagentRunRow }
  | { kind: "tasks"; index: number; status: ActivityStatus; startedAt?: string | undefined; row: BackgroundTaskRow };

/**
 * What this row is, independent of where it currently sits.
 *
 * The list re-sorts on live status, so a run finishing moves every row below
 * it. Rendered by position, Lit reuses the DOM of whatever used to be at that
 * index and only patches the text - so a control the reader is reaching for
 * becomes a different control under the finger, which is what the owner saw as
 * the list jittering and the button running away. Keyed by identity, a row that
 * moves takes its element with it.
 */
export function activityEntryKey(entry: ActivityListEntry): string {
  if (entry.kind === "subagents") return `subagents:${entry.row.subagent.sessionId}`;
  if (entry.kind === "runs") return `runs:${entry.row.run.runId}`;
  return `tasks:${entry.row.task.id}`;
}

/**
 * The order the list is read in: running work first, then the most recent.
 *
 * Grouping by kind put a finished task above a running subagent purely because
 * of which list it came from, so the row that mattered was somewhere in the
 * middle. Kind is a filter, not an ordering.
 */
export function orderActivityEntries(entries: readonly ActivityListEntry[]): ActivityListEntry[] {
  return [...entries].sort((left, right) => {
    const liveDelta = Number(isActiveActivityStatus(right.status)) - Number(isActiveActivityStatus(left.status));
    if (liveDelta !== 0) return liveDelta;
    // Subagents carry no start time, so without this they sink below finished work.
    const finishedDelta = Number(isFinishedActivityStatus(left.status)) - Number(isFinishedActivityStatus(right.status));
    if (finishedDelta !== 0) return finishedDelta;
    const startedDelta = (right.startedAt ?? "").localeCompare(left.startedAt ?? "");
    if (startedDelta !== 0) return startedDelta;
    return left.kind.localeCompare(right.kind);
  });
}

/**
 * How long the reader has been watching this turn, and whether that is long
 * enough to be worth questioning.
 *
 * A turn that has been running for hours looks exactly like one that started a
 * second ago: same dots, same wording. That is how a session held open by a
 * background process nobody can see reads as "still thinking" all night, while
 * every message typed into it silently queues behind it.
 */
export const LONG_TURN_AFTER_MS = 10 * 60 * 1000;

export function turnElapsedLabel(startedAtMs: number | undefined, nowMs: number): { text: string; long: boolean } | undefined {
  if (startedAtMs === undefined) return undefined;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (elapsedMs < 5000) return undefined;
  return { text: subagentRunDuration(elapsedMs), long: elapsedMs >= LONG_TURN_AFTER_MS };
}

/** Whether the list shows only live work or the whole history. */
export type ActivityScope = "active" | "all";

/** Statuses that mean "this is happening now". */
export function isActiveActivityStatus(status: ActivityStatus): boolean {
  return status === "working" || status === "running";
}

/** Terminal only. A subagent rests at "idle" between turns, so idle is not finished. */
export function isFinishedActivityStatus(status: ActivityStatus): boolean {
  return status === "done" || status === "failed" || status === "error" || status === "lost" || status === "stopped";
}

/**
 * The tab's own label. A chat that has run forty tasks and is running two says
 * so: the number that matters is what is live, not the size of the history.
 */
export function activityTabLabel(counts: { active: number }): string {
  return counts.active > 0 ? `Activity · ${String(counts.active)} running` : "Activity";
}

/** Kinds of work the activity list can be narrowed to. */
export type ActivityFilter = "all" | "subagents" | "runs" | "tasks";

export interface ActivityFilterOption {
  id: ActivityFilter;
  label: string;
  count: number;
}

/** The filter chips worth offering: "All" plus every kind that has rows. */
export function activityFilterOptions(activity: { rows: readonly unknown[]; runRows: readonly unknown[]; taskRows: readonly unknown[] }): ActivityFilterOption[] {
  const kinds: ActivityFilterOption[] = ([
    { id: "subagents", label: "Subagents", count: activity.rows.length },
    { id: "runs", label: "Agent runs", count: activity.runRows.length },
    { id: "tasks", label: "Tasks", count: activity.taskRows.length },
  ] satisfies ActivityFilterOption[]).filter((kind) => kind.count > 0);
  if (kinds.length <= 1) return kinds.length === 0 ? [] : kinds;
  const total = activity.rows.length + activity.runRows.length + activity.taskRows.length;
  return [{ id: "all", label: "All", count: total }, ...kinds];
}

/**
 * The filter actually applied. A chosen kind that has emptied out falls back to
 * "all", so a filter cannot leave the reader staring at an empty list.
 */
export function activityFilterInEffect(chosen: ActivityFilter, activity: { rows: readonly unknown[]; runRows: readonly unknown[]; taskRows: readonly unknown[] }): ActivityFilter {
  if (chosen === "subagents" && activity.rows.length > 0) return "subagents";
  if (chosen === "runs" && activity.runRows.length > 0) return "runs";
  if (chosen === "tasks" && activity.taskRows.length > 0) return "tasks";
  return "all";
}

/**
 * "Activity" means nothing on its own -- the reader has to be told, once, in
 * the panel itself, what these rows are and what tapping one does.
 */

/**
 * The drawer opens by itself only when it has something the reader has not
 * seen yet. Finished work waits behind one line instead of covering the
 * transcript -- which on a phone is most of the screen.
 */
/**
 * What the dock should say instead of "idle" when the assistant's own turn is
 * over but this chat still has work in flight, or `undefined` when there is
 * none and "idle" is the truth.
 */
export function backgroundWorkLabel(activity: { rows: readonly { status: string }[]; runRows: readonly { status: string }[]; taskRows: readonly { status: string }[] } | undefined): string | undefined {
  if (activity === undefined) return undefined;
  const running = [...activity.rows, ...activity.runRows, ...activity.taskRows]
    .filter((row) => row.status === "working" || row.status === "running").length;
  if (running === 0) return undefined;
  return running === 1 ? "idle · 1 background run" : `idle · ${String(running)} background runs`;
}

/**
 * What the dock says, once the state and the badge it was mapped to are both
 * known.
 *
 * The two were computed apart and could disagree. A run parked on an extension
 * dialog is "waiting for the user", so the badge said asking - but the state
 * behind it is still the word idle, and that word is what got drawn. The
 * reader was told nothing was happening by a marker that knew something was:
 * the run was holding still for an answer nobody was being asked for.
 *
 * The ask card takes the bottom of the screen when the question is a question
 * set, and the dock steps aside for it. A dialog has no such card here, which
 * is why this is the only place left to say it.
 *
 * The decision reads the state rather than the words drawn from it: the words
 * are whatever the activity feed last called itself, so matching on them would
 * miss the case as soon as a feed labelled the same state differently.
 */
export function activityDockLabel(category: string | undefined, state: string, text: string): string {
  return category === "asking" && state === "idle" ? "Waiting for your answer" : text;
}

/**
 * The drawer starts shut, whatever is happening.
 *
 * It used to open itself whenever something was running, had failed, or a
 * notification had arrived - which on a busy session is most of the time. That
 * took a fifth of a phone screen from the conversation to report things the
 * collapsed strip already summarises, and the reader had to close it again on
 * every visit. Attention belongs in the strip; taking the screen belongs to
 * the reader.
 */
export function topDrawerStartsOpen(): boolean {
  return false;
}

/** What the drawer renders for the activity section, derived once. */
export interface ActivityPanelState {
  rows: SubagentRow[];
  runRows: SubagentRunRow[];
  taskRows: BackgroundTaskRow[];
  summary: { working: boolean; failed: boolean };
  total: number;
  /** How many of those are happening now, which is what the tab reports. */
  activeCount: number;
}

/**
 * Which drawer section to show. The reader's last choice wins while it still
 * has something in it; otherwise the drawer falls back to whichever section
 * exists, so a section that empties out cannot leave a blank drawer behind.
 */
export function selectedTopDrawerTab(available: { activity: boolean; notifications: boolean; goals?: boolean }, preferred: TopDrawerTab | undefined): TopDrawerTab {
  if (preferred === "activity" && available.activity) return "activity";
  if (preferred === "notifications" && available.notifications) return "notifications";
  if (preferred === "goals" && available.goals === true) return "goals";
  if (available.notifications) return "notifications";
  if (available.activity) return "activity";
  // Goals change slowly, so they never take the drawer from work in flight -
  // but they are better than handing back a tab that has nothing behind it.
  return available.goals === true ? "goals" : "activity";
}

/**
 * One-line census of the activity section, so a folded drawer still answers
 * the only question a folded drawer has to answer: is anything still running,
 * and how much finished work is waiting to be opened.
 */
export function activityStripSummary(statuses: readonly ActivityStatus[]): { working: boolean; failed: boolean } {
  return {
    working: statuses.some((status) => status === "working" || status === "running"),
    failed: statuses.some((status) => status === "error" || status === "failed"),
  };
}

/** A subagent's status in the same voice the other activity rows use. */
export function subagentStatusLabel(status: string): string {
  if (status === "") return "Unknown";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function subagentRows(subagents: readonly SessionSubagentInfo[]): SubagentRow[] {
  return subagents.map((subagent) => {
    const status = subagent.status;
    const shortId = subagent.sessionId.slice(-8);
    // Every other row in the same column reports a capitalised status
    // (Running, Done, Failed), so passing the raw value through put "Working"
    // directly above "idle" and "error".
    const statusLabel = subagentStatusLabel(status);
    return {
      subagent,
      shortId,
      status,
      statusLabel,
      cwd: subagent.cwd,
      ariaLabel: `${statusLabel} subagent ${shortId}`,
    };
  });
}
