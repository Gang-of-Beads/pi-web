import { css, LitElement, html, nothing, type TemplateResult } from "lit";
import { scrollbarWidthOf } from "../scrollbarWidth";
import { showsJumpToBottom } from "../chatScrollPosition";
import { ScrollFollowGate, TOUCH_SETTLE_MS } from "../scrollFollowGate";
import { customElement, property, query, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { ChatDisclosureController } from "../chatDisclosure";
import { groupChatMessages, summarizeChatGroup, tryAppendGroupChatMessage, type ChatGroup } from "../chatGroups";
import { writeClipboardText } from "../clipboard";
import { capturePrependScrollAnchor, PREPEND_RESTORE_SETTLE_FRAMES, restorePrependScrollAnchor, type PrependScrollAnchor } from "../chatScrollAnchoring";
import { shouldRequestEarlierMessages } from "../chatHistoryLoading";
import { ChatScrollController, distanceFromScrollBottom, findFirstVisibleArticle, isNearScrollBottom, type ChatAnchorScrollPosition, type ChatScrollRestoreResult } from "../chatScrollPosition";
import { scrollEdgeClasses, ScrollEdgeTracker } from "../scrollEdges";
import type { AskUserSubmission, PendingAskUser, PendingExtensionDialog, QueuedSessionMessage, SessionActivity, SessionStatus } from "../api";
import { commandStateLabel, type CommandLedgerEntry } from "../commandLedger";
import type { ClosedExtensionDialog } from "../appState";
import { isResendableLine, recoverPromptFromLine, type RecoveredPrompt } from "../resendMessage";
import { isWaitingForUser } from "../sessionWaiting";
import type { SessionBackgroundTaskInfo, SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import type { ChatLine, ChatPart, MessageDelivery } from "./shared";
import type { DrawerSectionContext, QualifiedDrawerSectionContribution, QualifiedMessageRendererContribution } from "../plugins/types";
import { selectedDrawerTab, type DrawerTab } from "../drawerTabSelection";
import type { SessionStateBadgeKind } from "./activityBadge";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback } from "./ExtensionDialogCard";
import { deliveryTaken } from "../messageDelivery";
import { queuedUserLine, registerUserMessages } from "../userMessageRegister";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";
import "./ConversationMeter";
import "./FormattedText";
import "./ToolExecutionView";
import { sessionStateBadgeStyles as SessionStateBadgeStyles } from "./sessionStateBadgeStyles";
import { readingAnchorDecision, readingScrollCorrection, shouldHoldReadingPosition } from "../readingAnchor";
import { imageLoadScrollCorrection } from "../imageLoadScroll";
import { bottomAnchorAction } from "../bottomAnchor";

export const chatStyles = css`
  ${SessionStateBadgeStyles}
  /* Mobile browsers paint a rectangular highlight on tap, which looks pasted-on
     over a round or rounded control. Suppressed in favour of the app's own
     pressed and focus styling; :focus-visible still shows keyboard focus, so
     nothing is lost for keyboard users. */
  button, [role="button"], a, summary, label, input, select { font: var(--pi-text-xs) var(--pi-font-ui); -webkit-tap-highlight-color: transparent; }
  /* Follows the control's own shape rather than boxing a circle. */
  button:focus-visible, [role="button"]:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: var(--pi-focus-ring-offset); }
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
  .attachment-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); cursor: pointer; }
  .attachment-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  @media (hover: hover) { .attachment-zoom-close:hover { color: var(--pi-text-bright); border-color: var(--pi-accent); } }
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
    width: var(--pi-control-height-comfort); height: var(--pi-control-height-comfort); padding: 0;
    border: 1px solid var(--pi-border); border-radius: var(--pi-radius-md);
    background: var(--pi-surface-raised); color: var(--pi-text);
    font-size: 18px; line-height: 1; cursor: pointer;
    box-shadow: var(--pi-elevation-2);
  }
  .jump-to-bottom:focus-visible { border-color: var(--pi-accent); }
  @media (hover: hover) { .jump-to-bottom:hover { border-color: var(--pi-accent); } }
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
  .drawer-header:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: -3px; }
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
  .drawer-tab { flex: 0 0 auto; display: inline-flex; align-items: center; gap: var(--pi-space-3); box-sizing: border-box; min-height: 22px; padding: var(--pi-space-1) var(--pi-space-4); border: 1px solid transparent; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); font: inherit; font-size: var(--pi-text-2xs); font-weight: 600; white-space: nowrap; cursor: pointer; -webkit-tap-highlight-color: transparent; }
  @media (hover: hover) { .drawer-tab:hover { color: var(--pi-text-bright); } }
  .drawer-tab:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .drawer-tab.selected { border-color: var(--pi-border); background: var(--pi-surface); color: var(--pi-text-bright); }
  /* The count is a mark, not part of the name: bare "(3)" wore the label's
     own size, colour and weight and could not be scanned. */
  .drawer-tab-badge { flex: 0 0 auto; display: inline-block; min-width: 14px; border-radius: var(--pi-radius-pill); background: var(--pi-selection-bg); color: var(--pi-text-bright); padding: 0 var(--pi-space-2); font-size: var(--pi-text-2xs); line-height: 16px; text-align: center; }
  .drawer-header-actions { flex: 0 0 auto; display: flex; align-items: center; gap: var(--pi-space-1); }
  .drawer-body { flex: 0 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .drawer-body[hidden] { display: none; }
  /* Base sizes first, the coarse override after them: a media query carries no
     extra specificity, so a coarse rule written earlier loses to a base rule
     written later - the exact drift that pinned the collapse toggle at 32px on
     touch screens once already (shared.ts keeps the same incident record). */
  .drawer-control { box-sizing: border-box; min-height: var(--pi-control-height); border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); cursor: pointer; }
  .drawer-control { padding: 0 var(--pi-space-4); font: var(--pi-text-xs) var(--pi-font-ui); white-space: nowrap; }
  .drawer-collapse { display: inline-grid; place-items: center; width: var(--pi-control-height); height: var(--pi-control-height); padding: 0; }
  @media (pointer: coarse) {
    .drawer-header { min-height: var(--pi-control-height-touch); }
    .drawer-tab { min-height: var(--pi-control-height-touch); }
    .drawer-collapse { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); }
  }
  .drawer-control:focus-visible { background: var(--pi-selection-bg); color: var(--pi-text-bright); }
  @media (hover: hover) { .drawer-control:hover { background: var(--pi-selection-bg); color: var(--pi-text-bright); } }
  .drawer-control:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent); outline-offset: 1px; }
  .drawer-control:disabled { opacity: .5; background: transparent; cursor: default; }
  .drawer-icon { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; pointer-events: none; }
  .drawer-disclosure-icon.expanded { transform: rotate(90deg); }
  /* Severity is carried by the row itself, not only by a small coloured word:
     an error and a routine notice were otherwise structurally identical, so the
     tray had to be read to be triaged. The accent is a left border plus a very
     light wash, which stays legible in both themes without shouting. */
  /* Only the first line needs to clear the buttons; later lines use the full
     width, so a long error does not wrap into a narrow column. */
  /* Copy and dismiss sit together in one cluster rather than one floating over
     the text: the message wraps under them, so an absolute button either
     overlapped the text or forced padding that made every row look ragged. */
  @media (max-width: 640px) {
    .drawer-header { gap: var(--pi-space-2); padding-inline: 8px; }
    .drawer-tab { padding-inline: var(--pi-space-4); }
  }
  /* A short window is the case the drawer was breaking: keep it to a slice of
     the viewport so the transcript never becomes a letterbox. */
  /* The 64px bottom padding was the reservation for the activity dock back when
     it floated over the scroller's bottom edge (both arrived in the commit that
     added the dock); measured at 393x850 the last message sat 80px above the
     dock - its own 16px message-gap margin plus 64px of dead reservation on top
     of an in-flow dock that already carries its own margin. The dock is a row
     below the scroller now, so the transcript ends with the room it had before
     the dock existed: one space-7 of padding on top of the message rhythm's own
     16px margin, i.e. 32px from the last message to the dock. */
  .chat { flex: 1 1 auto; --pi-chat-sticky-top: -26px; height: 100%; min-height: 0; overflow: auto; overflow-anchor: none; padding: 26px var(--pi-chat-gutter) var(--pi-space-7); box-sizing: border-box; }
  .scroll-marker { display: block; height: 0; overflow: hidden; pointer-events: none; }
  /* Its own row of the column, so the transcript above can grow all it likes
     without moving a control the reader is aiming at. Tall questions scroll
     inside the slot rather than pushing the composer off the screen. */
  /* The geometry contract lives HERE, once. The slot owns the height budget
     (60vh, with a hard pixel ceiling for very tall displays where 60vh alone
     would grow a question past one glance); every waiting card fills it as a
     flex column whose body is the
     one scroller and whose action row never scrolls away. Cards opt in by
     stretching to the slot — a new waiting card needs no cap of its own.
     The flat version capped each card separately and missed one: the tall
     ask-user card pushed its submit below the fold. */
  /* Last in the transcript, in normal flow, the way a queued message is: with
     nothing appended after it while it waits, it is what scrolling to the
     bottom reaches, and once answered the replies that follow push it up on
     their own. Nothing is pinned, so the transcript scrolls at any card
     height and the card covers none of its own rows. */
  .waiting-slot { display: flex; flex-direction: column; gap: var(--pi-space-4); margin: 0 0 var(--pi-space-4); }
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
  /* The named work has no drawer page to open: the pill states it and stays a
     state line - no pointer affordance, because a control that looks
     actionable and is inert is worse than a sentence. */
  .activity-dock.background { width: fit-content; max-width: min(70%, 300px); border-color: var(--pi-purple-border); color: var(--pi-purple); padding: var(--pi-space-2) var(--pi-space-5); font: inherit; font-size: var(--pi-text-xs); }
  .activity-dock { transition: color var(--pi-motion-base) var(--pi-ease), background-color var(--pi-motion-base) var(--pi-ease), border-color var(--pi-motion-base) var(--pi-ease); }
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
  .dot { width: var(--pi-dot-md); height: var(--pi-dot-md); border-radius: 50%; background: currentColor; opacity: .45; flex: 0 0 auto; }
  .activity-dock.active .dot { animation: pulse 1s ease-in-out infinite; opacity: 1; }
  .activity-dock .state-dot { background: currentColor; }
  .activity-dock.working .state-dot { opacity: 1; }
  /* One column, shared by the transcript, the composer and the status dock.
     A wide screen is bought to be used, so the column takes the width it is
     given and keeps only a gutter at each edge. Everything that belongs to
     the conversation measures from this one value, so the three surfaces line
     up on a single left edge at every window size. */
  .chat > * { margin-inline: auto; }
  /* overflow: clip, not hidden: clip does not create a scroll container, so
     the sticky header keeps sticking to the transcript scroller. The card is
     the only owner of its corner geometry - a child that replicates the curve
     (the five reports of broken corners) is wrong at some device pixel ratio
     no matter which radius it picks, because two rasterizations of "the same"
     arc need not agree. The parent clips; children paint square. */
  .msg { max-width: var(--pi-chat-measure); min-width: 0; box-sizing: border-box; margin: 0 auto var(--pi-space-7); padding: var(--pi-space-6); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); background: var(--pi-surface-card); overflow: hidden; overflow: clip; }
  .msg.assistant, .msg.tool-image-output { background: var(--pi-surface); }
  .custom-card { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-lg); padding: var(--pi-space-5); background: var(--pi-surface); overflow: hidden; overflow: clip; display: grid; gap: var(--pi-space-3); }
  .custom-card-unknown { color: var(--pi-muted); }
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
  .msg.event-group > summary { position: sticky; top: -26px; z-index: 5; display: flex; align-items: center; gap: var(--pi-space-4); padding: var(--pi-space-4) var(--pi-space-6); border-bottom: 1px solid var(--pi-border-muted); background: var(--pi-bg); color: var(--pi-muted); }
  .msg.event-group.live > summary { border-bottom-color: var(--pi-success-border); background: var(--pi-success-bg); color: var(--pi-success); }
  .msg.event-group > summary .label { margin: 0; }
  .group-body { padding: 0 var(--pi-space-6) var(--pi-space-6); }
  .chat-image { display: block; max-width: 100%; max-height: 320px; margin: var(--pi-space-4) 0 0; border: 1px solid var(--pi-border-muted); border-radius: var(--pi-radius-md); object-fit: contain; cursor: zoom-in; }
  .chat-image:focus-visible { outline: var(--pi-focus-ring-width) solid var(--pi-accent, var(--pi-success-border)); outline-offset: var(--pi-focus-ring-offset); }
  dialog.image-zoom { position: fixed; inset: 0; margin: auto; max-width: calc(96vw - env(safe-area-inset-left) - env(safe-area-inset-right)); max-height: calc(96vh - env(safe-area-inset-top) - env(safe-area-inset-bottom)); width: fit-content; height: fit-content; padding: 0; border: none; background: transparent; overflow: visible; }
  dialog.image-zoom[open] { display: flex; }
  dialog.image-zoom::backdrop { background: rgba(0, 0, 0, 0.8); }
  .image-zoom-full { display: block; max-width: 100%; max-height: 100%; width: auto; height: auto; border-radius: var(--pi-radius-md); object-fit: contain; cursor: zoom-out; }
  .image-zoom-close { position: absolute; top: max(8px, env(safe-area-inset-top)); right: max(8px, env(safe-area-inset-right)); display: inline-grid; place-items: center; width: var(--pi-control-height); height: var(--pi-control-height); padding: 0; font: 16px/1 system-ui, sans-serif; color: var(--pi-muted); background: color-mix(in srgb, var(--pi-surface) 88%, transparent); border: 1px solid var(--pi-border); border-radius: var(--pi-radius-sm); cursor: pointer; }
  .image-zoom-close:focus-visible { color: var(--pi-text-bright); border-color: var(--pi-accent); }
  @media (hover: hover) { .image-zoom-close:hover { color: var(--pi-text-bright); border-color: var(--pi-accent); } }
  .image-zoom-close:focus-visible { outline: 1px solid var(--pi-border); outline-offset: 2px; }
  /* A child's conversation, over the parent's. It borrows the output viewer's
     frame because it is the same kind of thing - something opened from an
     activity row - but its body is a message list rather than a log. */
  .group-msg { max-width: 100%; min-width: 0; box-sizing: border-box; padding: var(--pi-space-5) 0; border-top: 1px solid var(--pi-border-muted); color: var(--pi-text); overflow: visible; }
  .group-msg.tool { color: var(--pi-warning); }
  .group-msg.tool-execution-shell { color: var(--pi-text); }
  .group-msg.system { color: var(--pi-muted); }
  .group-msg.bash { color: var(--pi-success); }
  .history-boundary { position: relative; z-index: 5; display: grid; gap: 3px; justify-items: center; margin: 0 auto var(--pi-space-7); color: var(--pi-muted); font-size: var(--pi-text-xs); text-align: center; }
  .history-load-button { border: 1px solid var(--pi-border); border-radius: var(--pi-radius-pill); background: var(--pi-surface); color: var(--pi-text-secondary); padding: var(--pi-space-3) var(--pi-space-6); font: var(--pi-text-xs) var(--pi-font-ui); cursor: pointer; }
  .history-load-button:focus { border-color: var(--pi-accent); color: var(--pi-text-bright); }
  @media (hover: hover) { .history-load-button:hover { border-color: var(--pi-accent); color: var(--pi-text-bright); } }
  .history-load-button:disabled { cursor: default; opacity: .55; }
  /* Queued messages are drawn in the transcript, gold; this slim strip carries
     only the count and the clear action the queue as a whole needs. */
  .queued-strip { display: flex; align-items: center; gap: var(--pi-space-3); margin: 0 0 var(--pi-space-4); padding: var(--pi-space-2) var(--pi-space-3); color: var(--pi-warning); font-size: var(--pi-text-xs); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: var(--pi-warning-surface); }
  /* The command receipts wear the queued-message gold: provisional, the
     browser's own record, not server history. */
  .command-row { display: flex; align-items: baseline; gap: var(--pi-space-3); min-width: 0; margin: 0 0 var(--pi-space-3); padding: var(--pi-space-2) var(--pi-space-3); font-size: var(--pi-text-xs); color: var(--pi-warning); border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-md); background: var(--pi-warning-surface); }
  .command-row.failed { color: var(--pi-error); border-color: var(--pi-error-border); background: var(--pi-error-surface); }
  .command-row.ok { color: var(--pi-success); border-color: var(--pi-success-border); background: var(--pi-success-surface); }
  .command-row .command-text { font-family: var(--pi-font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .command-row .command-state { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; opacity: .85; }
  .command-dismiss { flex: 0 0 auto; align-self: center; width: 24px; height: 24px; display: grid; place-items: center; padding: 0; border: 1px solid transparent; border-radius: var(--pi-radius-sm); background: transparent; color: inherit; font: inherit; font-size: var(--pi-text-sm); line-height: 1; cursor: pointer; }
  .command-dismiss:focus-visible { outline: var(--pi-focus-ring-width) solid currentColor; outline-offset: var(--pi-focus-ring-offset); }
  @media (hover: hover) { .command-dismiss:hover { border-color: currentColor; } }
  .queued-clear-button { flex: 0 0 auto; border: 1px solid var(--pi-warning-border); border-radius: var(--pi-radius-pill); background: transparent; color: var(--pi-warning); padding: var(--pi-space-1) var(--pi-space-3); font: inherit; cursor: pointer; }
  @media (pointer: coarse) {
    .command-dismiss, .image-zoom-close { width: var(--pi-control-height-touch); height: var(--pi-control-height-touch); }
    .queued-clear-button { min-height: var(--pi-control-height-touch); }
    .history-load-button { min-height: var(--pi-control-height-touch); }
  }
  .queued-clear-button:focus { border-color: var(--pi-warning); color: var(--pi-text-bright); }
  @media (hover: hover) { .queued-clear-button:hover { border-color: var(--pi-warning); color: var(--pi-text-bright); } }
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
  .empty-session.transcript-failed .failure-detail { color: var(--pi-muted); font-size: var(--pi-text-sm); white-space: pre-wrap; overflow-wrap: anywhere; }
  .empty-session button:focus-visible { border-color: var(--pi-accent); }
  @media (hover: hover) { .empty-session button:hover { border-color: var(--pi-accent); } }
  @media (pointer: coarse) { .empty-session button { min-height: var(--pi-control-height-touch); } }
  .msg-header { display: flex; align-items: center; justify-content: space-between; gap: var(--pi-space-5); min-height: 18px; margin-bottom: var(--pi-space-3); }
  /* Square by design: the card's overflow: clip rounds this against the same
     arc the border uses, in one rasterization. Every previous fix had this
     element guess the card's inner curve, and the guess broke at the phone's
     fractional device pixel ratio - five reports of the same corners. */
  .msg > .msg-header { position: sticky; top: -16px; z-index: 4; margin: calc(-1 * var(--pi-space-6)) calc(-1 * var(--pi-space-6)) var(--pi-space-3); padding: var(--pi-space-1) var(--pi-space-5); border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-surface-card); box-shadow: 0 8px 18px var(--pi-shadow-soft); }
  .msg.user > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-accent-border) 35%, transparent); background: var(--pi-selection-bg); }
  .msg.assistant > .msg-header .label, .msg.tool-image-output > .msg-header .label { color: var(--pi-text-secondary); }
  .msg.user > .msg-header .label { color: var(--pi-accent); }
  .msg.tool > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-warning-border) 35%, transparent); background: var(--pi-warning-surface); }
  .msg.bash > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-success) 35%, transparent); background: var(--pi-success-bg); }
  .msg.skill > .msg-header { border-bottom-color: color-mix(in srgb, var(--pi-purple-border) 35%, transparent); background: var(--pi-purple-surface); }
  .group-msg > .msg-header { position: sticky; top: -26px; z-index: 4; margin: -10px 0 var(--pi-space-4); padding: var(--pi-space-4) 0 var(--pi-space-3); border-bottom: 1px solid color-mix(in srgb, var(--pi-border-muted) 35%, transparent); background: var(--pi-bg); }
  .msg-header-trailing { min-width: 0; flex: 1 1 auto; display: inline-flex; align-items: center; justify-content: flex-end; gap: var(--pi-space-4); }
  .msg-actions { flex: 0 0 auto; display: inline-flex; gap: var(--pi-space-3); opacity: 0; transition: opacity var(--pi-motion-fast) var(--pi-ease); }  .msg-action { position: relative; display: inline-grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; border: 0; border-radius: var(--pi-radius-sm); background: transparent; color: var(--pi-muted); padding: 0; font: var(--pi-text-base) var(--pi-font-ui); line-height: 1; cursor: pointer; }
  /* A fingertip is wider than the drawn button, so the reach grows, not the
     icon - but only as far as the gap allows: a symmetric 10px expansion over
     a 6px gap made each button's right edge belong to its neighbour. */
  .msg-action::after { content: ""; position: absolute; inset: -10px -3px; }
  @media (pointer: coarse) { .msg-actions { gap: var(--pi-space-8); } .msg-action::after { inset: -10px; } }
  .msg-action:focus { color: var(--pi-text); border-color: var(--pi-accent); }
  @media (hover: hover) { .msg-action:hover { color: var(--pi-text); border-color: var(--pi-accent); } }
  .msg:focus-within > .msg-header .msg-actions, .group-msg:focus-within > .msg-header .msg-actions { opacity: 1; }
  @media (hover: hover) { .msg:hover > .msg-header .msg-actions, .group-msg:hover > .msg-header .msg-actions { opacity: 1; } }
  .label { display: block; color: var(--pi-muted); font: var(--pi-text-xs) var(--pi-font-mono); }
  .msg-header .label { margin: 0; }
  .msg-meta { min-width: 0; opacity: .28; border: 0; background: transparent; color: var(--pi-dim); padding: 0; font: var(--pi-text-2xs) var(--pi-font-ui); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: opacity var(--pi-motion-fast) var(--pi-ease); cursor: pointer; user-select: text; -webkit-user-select: text; }
  .msg:focus-within > .msg-header .msg-meta, .group-msg:focus-within > .msg-header .msg-meta, .msg-meta:focus, .msg-meta.expanded { opacity: 1; }
  @media (hover: hover) { .msg:hover > .msg-header .msg-meta, .group-msg:hover > .msg-header .msg-meta { opacity: 1; } }
  .msg-meta.expanded { flex: 1 1 auto; max-width: 100%; white-space: normal; overflow: visible; overflow-wrap: anywhere; text-overflow: clip; }
  .msg-meta:focus { outline: 1px solid var(--pi-border); outline-offset: 3px; border-radius: var(--pi-radius-xs); }
  @media (hover: none) {
    .msg-actions { opacity: 1; }
    .msg-meta { opacity: .75; max-width: 26px; }
    .msg-meta:not(.expanded) { display: inline-grid; width: 26px; height: 24px; place-items: center; font-size: 0; text-overflow: clip; }
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

/** Narrow the previous-status slot of a change to the one field queueGrew reads. */
function recordWithQueuedMessages(value: unknown): { queuedMessages?: readonly QueuedSessionMessage[] } | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const queued: unknown = Reflect.get(value, "queuedMessages");
  if (!Array.isArray(queued)) return undefined;
  return { queuedMessages: queued };
}

function renderDrawerDisclosureIcon(collapsed: boolean) {
  return html`
    <svg class=${`drawer-icon drawer-disclosure-icon${collapsed ? "" : " expanded"}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m9 18 6-6-6-6"></path>
    </svg>
  `;
}


function clampPercent(value: number): number {
  return clampNumber(value, 0, 100);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
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

export function chatDeliveryPresentation(delivery: MessageDelivery, queuePosition?: number): DeliveryPresentation {
  if (delivery.state === "sending") return { glyph: "◌", text: "Sending", label: "Sending", tone: "pending" };
  if (delivery.state === "failed") return { glyph: "!", text: "Not sent", label: "Not sent - the server never received this message", tone: "failed" };
  if (delivery.state === "queued") {
    const place = queuePosition === undefined ? "" : ` · ${String(queuePosition)}`;
    return { glyph: "✓", text: `Queued${place}`, label: "Queued - the server has this message and the agent will take it next", tone: "received" };
  }
  // "Sent" is a transport receipt and nothing more: the server's HTTP answer
  // arrived. It is not a promise that anything will happen, and a message can
  // sit here while the session is idle. Saying "Sent" and meaning "queued" is
  // what made a stalled message indistinguishable from a running one.
  if (delivery.state === "received") return { glyph: "✓", text: "Sent", label: "Sent - the server received this message, and has not yet said what it is doing with it", tone: "received" };
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
  /** True while this session's transcript is being read for the first time. */
  @property({ type: Boolean }) transcriptLoading = false;
  @property({ attribute: false }) transcriptFailed?: string;
  @property({ attribute: false }) findMessageRenderer?: (tag: string) => QualifiedMessageRendererContribution | undefined;
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
  /** The browser's own receipts for commands it issued in this session. */
  @property({ attribute: false }) commandLedger: CommandLedgerEntry[] = [];
  @property({ attribute: false }) closedDialogs: ClosedExtensionDialog[] = [];
  @property({ attribute: false }) onAnswerDialog?: ExtensionDialogAnswerCallback;
  @property({ attribute: false }) onCancelDialog?: ExtensionDialogCancelCallback;
  /**
   * Put a sent prompt back in the composer, images included. Offered on user
   * messages because a turn that fails after delivery leaves the transcript as
   * the only remaining copy of what was sent.
   */
  @property({ attribute: false }) onResendMessage?: (prompt: RecoveredPrompt) => void | Promise<void>;
  /** Child sessions (subagents) spawned by this session, most urgent first. */
  @property({ attribute: false }) subagents?: readonly SessionSubagentInfo[];
  /** Subagent-tool runs for this session, newest first, live ones first of all. */
  @property({ attribute: false }) subagentRuns?: readonly SessionSubagentRunInfo[];
  @property({ attribute: false }) backgroundTasks?: readonly SessionBackgroundTaskInfo[];
  @property({ attribute: false }) onClearServerQueue?: (queued: QueuedSessionMessage[]) => void;
  /** Close one settled receipt; a pending row is live work and refuses. */
  @property({ attribute: false }) onDismissLedgerRow?: (id: string) => void;
  /** Take one queued message back into the composer, leaving the rest queued. */
  @property({ attribute: false }) onRecallQueuedMessage?: (message: QueuedSessionMessage) => void;
  @property({ attribute: false }) onLoadMore?: () => void;
  /** Puts the cursor in the composer, for the empty session's way forward. */
  @property({ attribute: false }) onFocusComposer?: () => void;
  @query(".chat") private chat?: HTMLDivElement;
  @query(".drawer-tabs") private drawerTabs?: HTMLElement | null;
  @query("dialog.image-zoom") private imageZoomDialog?: HTMLDialogElement;
  @state() private pinnedToBottom = true;
  /** True while a touch gesture is moving the scroller; see onTouchStart. */
  private userScrollInFlight = false;
  private readonly followGate = new ScrollFollowGate();
  /** Whether the newest message is far enough away to be worth a button. */
  @state() private jumpToBottomVisible = false;
  @state() private zoomedImage: { src: string; alt: string } | undefined = undefined;
  @state() private expandedMetaKey: string | undefined;
  @state() private copiedMessageKey: string | undefined;
  @state() private currentConversationIndex: number | undefined;
  /** Exact chats whose top drawer the reader folded away, so switching
      conversations does not resurrect a drawer that was dismissed. */
  @state() private collapsedTopDrawerKeys: ReadonlySet<string> = new Set();
  /** Exact chats the reader explicitly unfolded, which outranks the default. */
  @state() private expandedTopDrawerKeys: ReadonlySet<string> = new Set();
  /** Section the reader last chose; ignored when that section has nothing. */
  @state() private topDrawerTab: DrawerTab | undefined;
  @property({ attribute: false }) drawerSections: readonly QualifiedDrawerSectionContribution[] = [];
  @property() drawerMachineId = "local";
  @property() drawerWorkspacePath?: string;
  @property() sessionCwd?: string;
  @property({ attribute: false }) onRunSectionCommand?: (command: string) => Promise<void>;
  /** When this browser first saw the current turn working, and a clock to age it. */
  @state() private turnStartedAtMs: number | undefined;
  @state() private turnNowMs = 0;
  private turnClockTimer: number | undefined;
  private imageZoomModalRegistration: RenderedModalRegistration | undefined;
  private readonly disclosures = new ChatDisclosureController();
  private readonly scrollController = new ChatScrollController();
  private readonly drawerTabEdgeTracker = new ScrollEdgeTracker(() => { this.requestUpdate(); });
  private suppressScrollSave = false;
  private suppressLoadMoreRequests = false;
  private loadMoreCheckFrame: number | undefined;
  private scrollToBottomFrame: number | undefined;
  private catchUpFollowTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * The waiting row's last content, kept so an outcome that settles under a
   * standing finger does not remove the ground being pressed. Cleared when the
   * press settles or the session changes: it belongs to this session only.
   */
  private heldWaiting: { ask: PendingAskUser | undefined; dialog: PendingExtensionDialog | undefined; queuedCount: number } | undefined;
  private heldWaitingClearTimer: ReturnType<typeof setTimeout> | undefined;
  /** Which open card's alignment a press deferred, so the release can replay it. */
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
  /**
   * A picture that finishes loading takes up room it was not taking before.
   *
   * At the bottom that just means following it down. Anywhere else it matters
   * which side of the reader it landed on: attachments are lazy, so scrolling
   * back through a session decodes them as they appear, and one completing
   * above the reader carries what they were reading downwards. The scroller
   * sets overflow-anchor: none, so the browser will not hold their place, and
   * the render-time gate never sees this because a load is not a render.
   *
   * The correction is the height the document gained, not a re-measurement:
   * by the time a load is reported the shift has already happened.
   */
  private readonly onImageLoad = (event: Event): void => {
    // Following the bottom needs no measurement, so it must not be reached
    // through one: an unrendered scroller would otherwise swallow the pin.
    if (this.pinnedToBottom) { this.scrollToBottom(); return; }
    const chat = this.chat;
    const target = event.target;
    const previousHeight = this.lastScrollHeight;
    if (chat) this.lastScrollHeight = chat.scrollHeight;
    if (!chat || !(target instanceof Element)) return;
    const outcome = imageLoadScrollCorrection({
      pinnedToBottom: false,
      userScrolling: this.userScrollInFlight,
      imageEndsAboveViewport: target.getBoundingClientRect().bottom <= chat.getBoundingClientRect().top,
      heightGained: previousHeight === undefined ? 0 : chat.scrollHeight - previousHeight,
    });
    if (outcome.action === "compensate") chat.scrollTop += outcome.pixels;
  };

  /** The scroller's height as of the last render, so a lazy image can report
   *  how much it grew the document rather than have it re-measured after. */
  /** The scroller's height as of the last completed render.
   *
   *  One writer only, in updated(): a second writer earlier in the same cycle
   *  recorded the new height before growth could be noticed, which silently
   *  disabled the bottom hold. A lazy image reads it to report how much it grew
   *  the document since that render. */
  private lastScrollHeight: number | undefined;
  private heightAtLastBottomHold: number | undefined;
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
    this.dockResizeObserver?.disconnect();
    this.dockResizeObserver = undefined;
    this.observedDock = undefined;
    this.releaseImageZoomModal();
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    if (this.loadMoreCheckFrame !== undefined) cancelAnimationFrame(this.loadMoreCheckFrame);
    if (this.scrollToBottomFrame !== undefined) cancelAnimationFrame(this.scrollToBottomFrame);
    if (this.conversationRailFrame !== undefined) cancelAnimationFrame(this.conversationRailFrame);
    if (this.catchUpFollowTimer !== undefined) {
      clearTimeout(this.catchUpFollowTimer);
      this.catchUpFollowTimer = undefined;
    }
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
    this.scrollController.clearScheduledSave();
    this.suppressScrollSave = false;
    this.suppressLoadMoreRequests = false;
    this.pendingScrollRestoreSessionId = undefined;
    this.pendingScrollRestorePosition = undefined;
    this.heldWaiting = undefined;
    if (this.heldWaitingClearTimer !== undefined) {
      clearTimeout(this.heldWaitingClearTimer);
      this.heldWaitingClearTimer = undefined;
    }
    this.prependRestoreToken += 1;
    if (this.restoreScrollFrame !== undefined) {
      cancelAnimationFrame(this.restoreScrollFrame);
      this.restoreScrollFrame = undefined;
    }
  }

  protected override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("sessionId")) {
      this.savePreviousSessionScrollPosition(changed.get("sessionId"));
      this.prepareSessionUiState();
    }
    if (changed.has("messages") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) this.pinnedToBottom = this.pinnedToBottom && (this.didChatHeightChange() || this.isNearBottom());
  }

  protected override update(changed: Map<string, unknown>): void {
    const decision = readingAnchorDecision({
      prepending: this.isPrependingMessages(changed),
      pinnedToBottom: this.pinnedToBottom,
    });
    const prependAnchor = decision === "prepend" ? this.capturePrependScrollAnchor() : undefined;
    // A reader who has scrolled up is reading something. Whatever grows above
    // them - a streaming reply, an activity row, a queued message - would slide
    // it out from under their eyes, because this scroller turns the browser's
    // own anchoring off so the prepend anchor can own the scroll position.
    // This is the same measure-and-restore, without the prepend's multi-frame
    // settle: an append shifts by a line, not by a page, and the settle also
    // suppresses load-more, which must keep working while reading.
    // Measuring the reader's place costs a walk over every message row and a
    // forced layout, so it only runs when content above them can have moved.
    // A reply streaming below the fold moves nothing above; a reader whose
    // gesture is in flight owns the scroll outright. Doing it on every render
    // made a long transcript crawl and snapped the view back under the thumb.
    const readingAnchor = decision === "hold-reading-position" && shouldHoldReadingPosition({
      pinnedToBottom: this.pinnedToBottom,
      contentAboveChanged: this.didContentAboveChange(changed),
      userScrolling: this.userScrollInFlight,
    })
      ? this.captureReadingAnchor()
      : undefined;
    super.update(changed);
    if (prependAnchor !== undefined) this.restorePrependScrollAnchor(prependAnchor);
    if (readingAnchor !== undefined) this.restoreReadingAnchor(readingAnchor);
  }

  /** Where the topmost readable row sits, so an update can put it back. */
  private captureReadingAnchor(): { element: Element; offset: number } | undefined {
    const chat = this.chat;
    if (!chat) return undefined;
    const element = this.firstVisibleArticle();
    if (element === undefined) return undefined;
    return { element, offset: element.getBoundingClientRect().top - chat.getBoundingClientRect().top };
  }

  private restoreReadingAnchor(anchor: { element: Element; offset: number }): void {
    const chat = this.chat;
    if (!chat || !anchor.element.isConnected) return;
    const offset = anchor.element.getBoundingClientRect().top - chat.getBoundingClientRect().top;
    chat.scrollTop += readingScrollCorrection(anchor.offset, offset);
  }

  protected override updated(changed: Map<string, unknown>): void {
    this.holdBottomEdge();
    if (changed.has("loadingMore") && !this.loadingMore) this.loadMoreRequested = false;
    if (changed.has("hasMore") && !this.hasMore) this.loadMoreRequested = false;
    if (changed.has("sessionId")) this.restoreScrollPosition();
    // A question no longer uses the transcript scroller, so opening one scrolls
    // nothing: it appears in its own row, already in view. The scroll that used
    // to bring it into view was itself moving the page under the reader.
    // A message queued from elsewhere grows the transcript from the bottom. It
    // arrives via the status (status.queuedMessages), not via `messages`, so it
    // would otherwise appear below the fold while the view stays put.
    else if (!changed.has("sessionId") && (changed.has("messages") || this.queueGrew(changed.get("status")) || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) && this.pinnedToBottom) this.scrollToBottom();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("messageTotal") || changed.has("hasMore") || changed.has("loadingMore")) this.scheduleConversationRailUpdate();
    if (changed.has("messages") || changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore") || changed.has("pendingAsk") || changed.has("pendingDialogs") || changed.has("closedDialogs")) this.continuePendingScrollRestore();
    if (changed.has("messages") || changed.has("hasMore") || changed.has("loadingMore")) this.requestLoadMoreIfNeeded();
    this.drawerTabEdgeTracker.observe(this.drawerTabs ?? undefined);
    this.publishScrollbarWidth();
    this.observeDock();
    // A reply that grows the transcript fires no scroll event, so deciding this
    // only while scrolling left a reader who stopped following four screens
    // from the newest message with no way back.
    const chat = this.chat;
    if (chat !== undefined) this.jumpToBottomVisible = showsJumpToBottom(chat);
    if (changed.has("status") || changed.has("activity") || changed.has("isSendingPrompt")) this.syncTurnClock();
    if (changed.has("zoomedImage")) this.syncImageZoomDialog();
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

  private observedDock: HTMLElement | undefined;
  private dockResizeObserver: ResizeObserver | undefined;

  private observeDock(): void {
    // A4: the dock room used to be measured on every render, forcing a
    // synchronous layout per update. The observer publishes when the dock
    // actually resizes (pill ↔ row ↔ touch height).
    const dock = this.renderRoot.querySelector(".activity-dock");
    const dockEl = dock instanceof HTMLElement ? dock : undefined;
    if (this.observedDock === dockEl) return;
    this.dockResizeObserver?.disconnect();
    this.observedDock = dockEl;
    this.dockResizeObserver = undefined;
    if (dockEl === undefined) {
      this.publishDockRoom();
      return;
    }
    if (typeof ResizeObserver === "undefined") return;
    this.dockResizeObserver = new ResizeObserver(() => {
      this.publishDockRoom();
    });
    this.dockResizeObserver.observe(dockEl);
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

  private releaseImageZoomModal(): void {
    const registration = this.imageZoomModalRegistration;
    this.imageZoomModalRegistration = undefined;
    registration?.unregister();
  }

  override render() {
    const groups = this.groupedMessages();
    return html`
      ${this.renderTopNotices()}
      <div class="chat-wrap">
        ${this.renderConversationRail()}
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @touchend=${() => { this.onTouchEnd(); }} @touchcancel=${() => { this.onTouchEnd(); }} @pointerdown=${() => { this.notePressStart(); }} @pointerup=${() => { this.releasePointer(); }} @pointercancel=${() => { this.releasePointer(); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }}>
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
          ${this.renderCommandLedger()}
          ${this.renderClosedDialogs()}
          ${this.renderWaitingForYou()}
        </div>
        ${this.renderJumpToBottom()}
        ${this.renderActivityDock()}
      </div>
      ${this.renderImageZoom()}
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
    const drawer = this.renderTopDrawer();
    if (drawer === null) return null;
    return html`<div class="top-notices">${drawer}</div>`;
  }

  /**
   * The session drawer hosts whatever sections plugins contribute - the
   * goals panel, a terminal, anything registered on this machine - and the
   * reader's own choice of section survives until they change it.
   */
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

  /**
   * The scope a contributed section is drawn for. Undefined while no session
   * is selected: a section asked about nothing would have to invent an answer.
   */
  private drawerSectionContext(): DrawerSectionContext | undefined {
    if (this.sessionId === "") return undefined;
    const runSectionCommand = this.onRunSectionCommand;
    return {
      sessionId: this.sessionId,
      machineId: this.drawerMachineId,
      workspacePath: this.drawerWorkspacePath,
      sessionCwd: this.sessionCwd,
      requestUpdate: () => { this.requestUpdate(); },
      runCommand: runSectionCommand === undefined ? undefined : (command) => runSectionCommand(command),
    };
  }

  /**
   * Collapse and tab choice follow the exact chat, not just its session id, so
   * the same session id on another machine or cwd starts fresh.
   */
  private topDrawerKey(): string {
    return JSON.stringify([this.drawerMachineId, this.drawerWorkspacePath, this.sessionId]);
  }


  private renderTopDrawer(): TemplateResult | null {
    const sectionContext = this.drawerSectionContext();
    if (sectionContext === undefined) return null;
    const sections = this.drawerSections;
    if (sections.length === 0) return null;
    const sectionsWithContent = sections.filter((section) => section.available?.(sectionContext) !== false).map((section) => section.id);
    if (sectionsWithContent.length === 0) return null;
    const contentSections = sections.filter((section) => sectionsWithContent.includes(section.id));
    const tab = selectedDrawerTab({ sections: sections.map((section) => section.id), withContent: sectionsWithContent }, this.topDrawerTab);
    if (tab === undefined) return null;
    const key = this.topDrawerKey();
    const collapsed = this.expandedTopDrawerKeys.has(key)
      ? false
      : this.collapsedTopDrawerKeys.has(key) || !topDrawerStartsOpen();
    const toggleLabel = collapsed ? "Show session sections" : "Hide session sections";
    return html`
      <section
        class=${`top-drawer${collapsed ? " collapsed" : ""}`}
        role="region"
        aria-label="Session drawer"
      >
        <header class="drawer-header" tabindex="-1">
          <div class=${`drawer-tabs-frame${scrollEdgeClasses(this.drawerTabEdgeTracker.edges)}`}>
          <div class="drawer-tabs" role="tablist" aria-label="Session drawer sections" @scroll=${() => { this.drawerTabEdgeTracker.refresh(); }} @keydown=${(event: KeyboardEvent) => { this.onDrawerTabsKeydown(event); }}>
            ${contentSections.map((section) => html`
            <button
              type="button"
              role="tab"
              id=${`drawer-tab-${section.id}`}
              class=${`drawer-tab${tab === section.id ? " selected" : ""}`}
              aria-selected=${String(tab === section.id)}
              tabindex=${tab === section.id ? "0" : "-1"}
              aria-controls=${`drawer-panel-${section.id}`}
              @click=${() => { this.selectTopDrawerTab(section.id, collapsed); }}
            >
              <span class="drawer-tab-label">${section.title}</span>${sectionBadgeMark(section, sectionContext)}
            </button>`)}
          </div>
          </div>
          <div class="drawer-header-actions">
            <button
              type="button"
              class="drawer-control drawer-collapse drawer-toggle"
              aria-label=${toggleLabel}
              title=${toggleLabel}
              aria-expanded=${String(!collapsed)}
              aria-controls=${`drawer-panel-${tab}`}
              @click=${() => { this.toggleTopDrawer(collapsed); }}
            >${renderDrawerDisclosureIcon(collapsed)}</button>
          </div>
        </header>
        <div class="drawer-body" ?hidden=${collapsed}>
          ${contentSections.filter((section) => section.id === tab).map((section) => html`
            <div class="drawer-section-panel" id=${`drawer-panel-${section.id}`} role="tabpanel" aria-labelledby=${`drawer-tab-${section.id}`}>
              ${section.render(sectionContext)}
            </div>`)}
        </div>
      </section>
    `;
  }

  private selectTopDrawerTab(tab: Exclude<DrawerTab, undefined>, collapsed: boolean): void {
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
  private activityPanelState(): ActivityPanelState | undefined {
    // The dock pill counts live work; the per-row presentation shapes retired
    // with the activity panel they were built for.
    const total = (this.subagents?.length ?? 0) + (this.subagentRuns?.length ?? 0) + (this.backgroundTasks?.length ?? 0);
    if (total === 0) return undefined;
    const working = [...this.subagents ?? [], ...this.subagentRuns ?? [], ...this.backgroundTasks ?? []]
      .filter((row) => row.status === "working" || row.status === "running").length;
    return { working };
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

  /**
   * Every user message, once.
   *
   * The settled transcript, the bubbles this browser is still sending, and the
   * queue the daemon reports are three descriptions of one population. They
   * used to be reconciled pairwise, so any disagreement produced a second row -
   * the duplicate reported through ten separate fixes. They are now collected
   * into one register keyed by message identity, where a key holds one row by
   * construction. Settled and pending are two slices of that single population
   * rather than two lists that have to agree with each other.
   */
  private transcriptSplit(): { settled: ChatLine[]; pending: ChatLine[] } {
    const rows = registerUserMessages({
      transcript: this.messages,
      optimistic: this.clientQueuedMessages.map((message, position) => queuedUserLine(message, position)),
      queued: this.status?.queuedMessages ?? [],
      synthesise: (message, position) => queuedUserLine(message, position),
    });
    // Settled rows go back to their transcript positions; a sparse slot means
    // that message is pending, so the holes are closed rather than filled.
    const byPosition = new Map<number, ChatLine>();
    const pending: ChatLine[] = [];
    for (const row of rows) {
      if (row.state !== "settled") pending.push(row.line);
      else if (row.transcriptIndex !== undefined) byPosition.set(row.transcriptIndex, row.line);
    }
    const settled = [...byPosition.entries()].sort((a, b) => a[0] - b[0]).map(([, line]) => line);
    return { settled, pending };
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
   *
   * The anchor is the daemon's own turn start (the transcript's last input
   * boundary) whenever the status carries one, so a tab that joins a working
   * session mid-turn continues the clock instead of restarting it from the
   * moment it happened to look - which made a turn that had been running for
   * minutes read as freshly started, and made "is this stuck?" unanswerable.
   * A daemon that does not publish the field degrades to the first-sighting
   * anchor, which is an honest lower bound.
   */
  private syncTurnClock(): void {
    const working = this.isSessionLive();
    if (!working) {
      this.turnStartedAtMs = undefined;
      this.stopTurnClock();
      return;
    }
    const daemonAnchor = Date.parse(this.status?.turnStartedAt ?? "");
    if (Number.isFinite(daemonAnchor)) this.turnStartedAtMs = daemonAnchor;
    else this.turnStartedAtMs ??= Date.now();
    this.turnNowMs = Date.now();
    if (this.turnClockTimer !== undefined) return;
    // Surface backed up: the turn-elapsed readout. A 1s display tick, not a
    // server poll - it only re-renders the clock already in the DOM.
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
    // The named work has no drawer page to open any more: the dock states it
    // and stays a pill, because a control that looks actionable and is inert
    // is worse than a state line.
    if (showBackground) {
      return html`
        <div class="activity-dock background" aria-live="polite">
          <span class="dot"></span>
          <span class="activity-text">${background}</span>
        </div>
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
   * Delivery mark for a message this browser sent, in the corner of its own
   * bubble the way a messaging app reports a send. Messages loaded from history
   * carry no delivery state and stay unmarked: they arrived long ago, and a
   * transcript of check marks would be noise. A message the agent has taken
   * looks the same, so a bubble does not change appearance across a reload.
   */
  private renderDeliveryMark(message: ChatLine) {
    const delivery = message.meta?.delivery;
    if (!chatDeliveryMarkerVisible(delivery) || delivery === undefined) return null;
    // Where this message sits in the server's queue, so the card carries its own
    // count instead of a second surface counting them all again.
    const queued = this.status?.queuedMessages ?? [];
    const index = queued.findIndex((entry) => entry.clientMessageId === delivery.clientMessageId);
    const presentation = chatDeliveryPresentation(delivery, index === -1 ? undefined : index + 1);
    return html`
      <div class=${`delivery-mark ${presentation.tone}`} role="status" aria-label=${presentation.label}>
        <span class="delivery-glyph" aria-hidden="true">${presentation.glyph}</span>
        <span class="delivery-text">${presentation.text}</span>
      </div>
    `;
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
    // Keys are absolute positions in the conversation, not offsets into the
    // loaded window: settled rows are keyed messageStart + i, so pending rows
    // that ignored messageStart collided with history rows as soon as earlier
    // messages had been loaded, and changed key on the way to settled - which
    // makes lit replace the element instead of updating it.
    const base = this.messageStart + this.messages.length;
    return html`${repeat(pending, (line, index) => this.messageAnchorKey(base + index), (line, index) => this.renderMessage(line, base + index))}`;
  }

  private renderQueuedMessages() {
    // Every queued message is drawn in the transcript, marked gold, so the only
    // thing a panel could add is a second listing of the same text. One action
    // still needs a home: clearing the whole server queue without stopping the
    // work it is waiting behind. A slim strip carries that, nothing more.
    // The cards above are the queue: each one is gold, says its own state, and
    // carries its own Recall. Counting them again here was a second listing of
    // what the reader can already see, in a second visual language, and the two
    // read from different facts and disagreed. Only the action that has no
    // other home is left - clearing the whole server queue without stopping the
    // work it waits behind.
    const serverQueued = this.status?.queuedMessages ?? [];
    if (serverQueued.length === 0 || this.onClearServerQueue === undefined) return null;
    return html`
      <div class="queued-strip">
        <button type="button" class="queued-clear-button" title="Clear queued messages without stopping active work" @click=${() => { this.onClearServerQueue?.(serverQueued); }}>Clear queue</button>
      </div>
    `;
  }

  /**
   * What the session is waiting on the reader for, held outside the transcript.
   *
   * A question drawn at the end of the transcript is pushed down by everything
   * that arrives after it - a streaming reply, tool rows, an injected
   * continuation, a notification, a queued strip - so on a phone the option the
   * reader aimed at has moved by the time the tap lands, and the click is
   * delivered to whatever slid underneath. The owner reported that as "I have
   * to tap twice" six times before the movement, rather than the tap, was
   * identified as the cause.
   *
   * This is a real row of the layout, not an overlay: the transcript gives up
   * the height, so nothing is covered and no tap is intercepted.
   */
  private renderWaitingForYou() {
    const dialog = this.pendingDialogs[0];
    if (this.pendingAsk !== undefined || dialog !== undefined) {
      this.heldWaiting = { ask: this.pendingAsk, dialog, queuedCount: this.pendingDialogs.length - 1 };
      return this.renderWaitingSlot(this.pendingAsk, dialog, this.pendingDialogs.length - 1);
    }
    // The outcome settled, but a finger may be standing on the row: removing it
    // at that instant retargets the imminent click to whatever slides
    // underneath - the theft this row exists to end, reintroduced at its exit.
    // The last content is held through the press and the release grace; a tap
    // on a settled dialog is answered as stale by the daemon, which is honest
    // and harmless where a retargeted tap is neither.
    const held = this.heldWaiting;
    if (held !== undefined && this.followGate.holdsOrSettling(Date.now())) {
      return this.renderWaitingSlot(held.ask, held.dialog, held.queuedCount);
    }
    this.heldWaiting = undefined;
    return null;
  }

  private renderWaitingSlot(ask: PendingAskUser | undefined, dialog: PendingExtensionDialog | undefined, queuedCount: number) {
    return html`
      <div class="waiting-slot" role="region" aria-label="Waiting for your answer">
        ${ask === undefined ? null : html`
          <ask-user-card
            .ask=${ask}
            .draftSessionId=${this.askDraftSessionId}
            .onSubmit=${this.onSubmitAsk}
          ></ask-user-card>
        `}
        ${dialog === undefined ? null : html`
          <extension-dialog-card
            class="open-dialog-card"
            .dialog=${dialog}
            .onAnswer=${this.onAnswerDialog}
            .onCancel=${this.onCancelDialog}
          ></extension-dialog-card>
          ${queuedCount > 0
            ? html`<p class="queued-dialogs" role="status">${String(queuedCount)} more extension ${queuedCount === 1 ? "dialog" : "dialogs"} queued</p>`
            : null}
        `}
      </div>
    `;
  }

  /**
   * The receipts for commands this browser issued. A slash command's route
   * produces no message and no pending row; until these rows existed, a
   * pressed goal button held no evidence anywhere that the press happened,
   * and the owner pressed Resume four times against a command that had been
   * accepted every time. Queued-versus-running is derived from the live
   * status: the daemon runs a command after the current reply, and the row
   * says which side of that wait it is on.
   */
  private renderCommandLedger() {
    if (this.commandLedger.length === 0) return null;
    const streaming = this.status?.isStreaming === true;
    return html`
      ${this.commandLedger.map((entry) => html`
        <div class=${`command-row ${entry.state}`} role="status">
          <span class="command-text">${entry.text}</span>
          <span class="command-state">${commandStateLabel(entry, streaming)}</span>
          ${entry.state === "pending" || this.onDismissLedgerRow === undefined ? null : html`
            <button type="button" class="command-dismiss" title="Dismiss this receipt" aria-label="Dismiss receipt for ${entry.text}" @click=${() => { this.onDismissLedgerRow?.(entry.id); }}>×</button>
          `}
        </div>
      `)}
    `;
  }

  /** Settled dialogs belong to the story, so they stay where they happened. */
  private renderClosedDialogs() {
    if (this.closedDialogs.length === 0) return null;
    return html`
      ${repeat(
        this.closedDialogs,
        (closed) => closed.dialog.dialogId,
        (closed) => html`
          <extension-dialog-card
            class="closed-dialog-card"
            data-scroll-anchor-id=${`closed-dialog:${closed.dialog.dialogId}`}
            .outcome=${closed}
          ></extension-dialog-card>
        `,
      )}
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
   *
   * An empty transcript is two different states, and only one of them is this
   * one: a session still being read looks identical until its history lands.
   * Claiming emptiness then invited the reader to write the first message and
   * dropped the history on top of it a moment later, so the loading case says
   * so and offers nothing.
   */
  private renderEmptySession() {
    if (this.loadingMore) return null;
    if (this.transcriptLoading) {
      return html`
        <div class="empty-session" role="status">
          <p>Loading this session…</p>
        </div>
      `;
    }
    // A failed read is the third state, and the one that must never claim
    // emptiness: a session whose working directory is gone renders identically
    // to a fresh one otherwise, and the empty claim invites writing into it.
    // The daemon's own words are the most precise thing on offer.
    if (this.transcriptFailed !== undefined) {
      return html`
        <div class="empty-session transcript-failed" role="alert">
          <p>Couldn't load this session.</p>
          <p class="failure-detail">${this.transcriptFailed}</p>
        </div>
      `;
    }
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

  /**
   * The runtime keeps the card chrome and a plugin supplies only the body, so
   * a plugin card cannot opt out of the corner and settled-outcome contracts.
   * A tag nobody claims renders as unknown rather than as nothing: absence of
   * a renderer is not evidence that the message is empty.
   */
  private renderCustomPart(part: Extract<ChatPart, { type: "custom" }>) {
    const renderer = this.findMessageRenderer?.(part.tag);
    if (renderer === undefined) {
      return html`<div class="part custom-card custom-card-unknown">
        <strong>Unrecognized message</strong>
        <small>Nothing on this machine renders "${part.tag}".</small>
      </div>`;
    }
    const body = this.renderCustomBody(renderer, part);
    return html`<div class="part custom-card">${body}</div>`;
  }

  private renderCustomBody(renderer: QualifiedMessageRendererContribution, part: Extract<ChatPart, { type: "custom" }>) {
    try {
      return renderer.render({
        sessionId: this.sessionId,
        messageId: "",
        tag: part.tag,
        payload: part.payload,
        streaming: this.status?.isStreaming === true,
        createdAt: undefined,
      });
    } catch (error) {
      console.error(`Plugin ${renderer.pluginId} failed rendering ${part.tag}`, error);
      return html`<strong>This message could not be rendered</strong><small>${renderer.pluginId} failed while drawing "${part.tag}".</small>`;
    }
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
    return this.queueEntryFor(line) !== undefined || line.meta?.delivery?.state === "queued";
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
    if (part.type === "custom") return this.renderCustomPart(part);
    if (part.type === "toolCall") return html`<div class="part tool-line">▶ ${part.toolName}<span class="summary">${part.summary}</span></div>`;
    if (part.type === "toolExecution") return html`<tool-execution-view class="part" .execution=${part} .streaming=${this.status?.isStreaming === true}></tool-execution-view>`;
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
    this.touchStartY = firstTouchY(event);
    this.notePressStart();
  }

  private onTouchEnd(): void {
    this.userScrollInFlight = false;
    this.releasePointer();
  }

  /**
   * Every way a press can end routes here, including the pointercancel a phone
   * fires instead of pointerup once a press turns into a scroll gesture. A
   * release path that did not run would leave the gate holding and the
   * transcript frozen, which is worse than the movement it prevents.
   */
  private releasePointer(): void {
    this.followGate.notePointerUp(Date.now());
    // A ghost row held for this press has no data change left to re-render it
    // away; nudge an update once the release grace expires.
    if (this.heldWaiting !== undefined) {
      if (this.heldWaitingClearTimer !== undefined) clearTimeout(this.heldWaitingClearTimer);
      this.heldWaitingClearTimer = setTimeout(() => {
        this.heldWaitingClearTimer = undefined;
        this.requestUpdate();
      }, TOUCH_SETTLE_MS + 1);
    }
    // A reader who scrolled away during the press is no longer pinned, so the
    // suppressed follow is dropped rather than dragging them back down.
    if (!this.followGate.takeSuppressedFollow() || !this.pinnedToBottom) return;
    // The settle grace still refuses following, which is what lets the tap land;
    // the catch-up therefore waits for it to expire instead of being dropped.
    if (this.catchUpFollowTimer !== undefined) clearTimeout(this.catchUpFollowTimer);
    this.catchUpFollowTimer = setTimeout(() => {
      this.catchUpFollowTimer = undefined;
      if (!this.pinnedToBottom) return;
      this.scrollToBottom();
    }, TOUCH_SETTLE_MS);
  }

  private notePressStart(): void {
    // A catch-up scheduled by the previous release belongs to that press. Left
    // running it can fire up to TOUCH_SETTLE_MS into this press, scrolling the
    // transcript between the new press and its click, so the click lands on
    // whatever moved into the tap's place. Symmetric with the deferral above;
    // the new press's own release schedules its own catch-up.
    if (this.catchUpFollowTimer !== undefined) {
      clearTimeout(this.catchUpFollowTimer);
      this.catchUpFollowTimer = undefined;
    }
    this.followGate.notePointerDown(Date.now());
  }

  /**
   * A gesture owns the scroll; a stationary press does not. Setting the
   * in-flight flag at touchstart made every finger press read as scrolling,
   * which routed the bottom hold to leave-alone and let streamed growth slide
   * the ask card out from under the standing finger - the round-2 reviewers
   * proved the phone path was byte-identical to the pre-fix behavior. The
   * flag now arms on the first actual movement.
   */
  private onTouchMove(event: TouchEvent) {
    this.userScrollInFlight = true;
    const y = firstTouchY(event);
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

  /**
   * Whether anything above the reader can have moved.
   *
   * Only a change to where the window starts puts rows above them. A reply
   * streaming into the last row, an activity chip, a queued message - all of
   * that grows below, and restoring a position against it costs a full row
   * walk and a forced layout to move the scroller by zero pixels.
   */
  private didContentAboveChange(changed: Map<string, unknown>): boolean {
    return changed.has("messageStart") || changed.has("hasMore") || changed.has("loadingMore");
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

  private holdBottomEdge(): void {
    const chat = this.chat;
    if (chat === undefined) return;
    const currentHeight = chat.scrollHeight;
    const action = bottomAnchorAction({
      pinnedToBottom: this.pinnedToBottom,
      userScrolling: this.userScrollInFlight,
      previousHeight: this.heightAtLastBottomHold,
      currentHeight,
    });
    this.heightAtLastBottomHold = currentHeight;
    if (action !== "hold-bottom") return;
    this.withSuppressedScrollSave(() => {
      chat.scrollTop = chat.scrollHeight;
      this.lastScrollTop = chat.scrollTop;
      this.lastClientHeight = chat.clientHeight;
    });
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

  restoreScrollPosition() {
    const sessionId = this.sessionId;
    if (this.restoreScrollFrame !== undefined) cancelAnimationFrame(this.restoreScrollFrame);
    this.restoreScrollFrame = requestAnimationFrame(() => {
      this.restoreScrollFrame = undefined;
      if (this.sessionId !== sessionId) return;
      this.withSuppressedScrollSave(() => {
        // A pending question no longer lives in the scroller, so a session with
        // one restores like any other: the question is already in view in its
        // own row, whatever the transcript position.
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

export function topDrawerStartsOpen(): boolean {
  return false;
}

function sectionBadgeMark(section: QualifiedDrawerSectionContribution, context: DrawerSectionContext): TemplateResult | typeof nothing {
  const badge = section.badge?.(context);
  if (badge === undefined || badge === "") return nothing;
  return html`<span class="drawer-tab-badge">${String(badge)}</span>`;
}

interface ActivityPanelState {
  /** How many pieces of this chat's background work are happening now. */
  working: number;
}

export function backgroundWorkLabel(activity: { working: number } | undefined): string | undefined {
  if (activity === undefined) return undefined;
  if (activity.working === 0) return undefined;
  return activity.working === 1 ? "idle · 1 background run" : `idle · ${String(activity.working)} background runs`;
}

export function activityDockLabel(category: string | undefined, state: string, text: string): string {
  return category === "asking" && state === "idle" ? "Waiting for your answer" : text;
}


function firstTouchY(event: TouchEvent): number | undefined {
  const touches: unknown = event.touches;
  if (typeof TouchList !== "undefined" && touches instanceof TouchList) return touches[0]?.clientY;
  return undefined;
}


/** How long a run has been going, in the shortest form that stays readable. */
export function subagentRunDuration(elapsedMs: number): string {
  const seconds = Math.max(0, Math.round(elapsedMs / 1000));
  if (seconds < 60) return `${String(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`;
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

export const LONG_TURN_AFTER_MS = 10 * 60 * 1000;

export function turnElapsedLabel(startedAtMs: number | undefined, nowMs: number): { text: string; long: boolean } | undefined {
  if (startedAtMs === undefined) return undefined;
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (elapsedMs < 5000) return undefined;
  return { text: subagentRunDuration(elapsedMs), long: elapsedMs >= LONG_TURN_AFTER_MS };
}
