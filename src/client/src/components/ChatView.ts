import { LitElement, html, type TemplateResult } from "lit";
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
import { turnEndedUnanswered, isWaitingForUser } from "../sessionWaiting";
import type { SessionBackgroundTaskInfo, SessionNotification, SessionSubagentInfo, SessionSubagentRunInfo } from "../../../shared/apiTypes";
import type { ChatLine, ChatPart, MessageDelivery } from "./shared";
import { chatStyles, renderSessionWarningIcon } from "./shared";
import type { SessionStateBadgeKind } from "./activityBadge";
import "./AskUserCard";
import "./ExtensionDialogCard";
import type { ExtensionDialogAnswerCallback, ExtensionDialogCancelCallback, ExtensionDialogDismissCallback } from "./ExtensionDialogCard";
import { transcriptWithPendingInQueueOrder } from "../messageDelivery";
import { registerRenderedModal, type RenderedModalRegistration } from "./modalLayerRegistry";
import "./ConversationMeter";
import "./FormattedText";
import "./ToolExecutionView";

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
  /** A log or artifact opened from the activity list, read in its own view. */
  @property({ attribute: false }) activityOutput?: ActivityOutputView | undefined;
  @property({ attribute: false }) onCloseActivityOutput?: () => void;
  @query(".chat") private chat?: HTMLDivElement;
  @query(".drawer-tabs") private drawerTabs?: HTMLElement | null;
  @query("dialog.image-zoom") private imageZoomDialog?: HTMLDialogElement;
  @query("dialog.activity-output") private activityOutputDialog?: HTMLDialogElement;
  @state() private pinnedToBottom = true;
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
  /** Section the reader last chose; ignored when that section has nothing. */
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
    if (changed.has("status") || changed.has("activity") || changed.has("isSendingPrompt")) this.syncTurnClock();
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
        <div class="chat" @scroll=${() => { this.onScroll(); }} @wheel=${(event: WheelEvent) => { this.onWheel(event); }} @touchstart=${(event: TouchEvent) => { this.onTouchStart(event); }} @touchmove=${(event: TouchEvent) => { this.onTouchMove(event); }}>
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
          ${this.renderQueuedMessages()}
          ${this.renderOpenAsk()}
          ${this.renderExtensionDialogs()}
        </div>
        ${this.renderActivityDock()}
      </div>
      ${this.renderImageZoom()}
      ${this.renderActivityOutput()}
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
    if (activity === undefined && inbox === undefined) return null;
    const tab = selectedTopDrawerTab({ activity: activity !== undefined, notifications: inbox !== undefined }, this.topDrawerTab);
    const key = this.topDrawerKey();
    const collapsed = this.expandedTopDrawerKeys.has(key)
      ? false
      : this.collapsedTopDrawerKeys.has(key) || !topDrawerStartsOpen({ working: activity?.summary.working === true, failed: activity?.summary.failed === true, notifications: inbox !== undefined });
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
                <span class="drawer-tab-label">${activityTabLabel({ active: activity.activeCount, total: activity.total })}</span>
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
          </div>
          </div>
          ${collapsed && activity !== undefined && activity.summary.label !== ""
            ? html`<span class="drawer-summary">${activity.summary.label}</span>`
            : null}
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
          ${activity.total === 0 || scope === "empty-active" ? html`<p class="drawer-hint">${ACTIVITY_TAB_HINT}</p>` : null}
          ${this.renderActivityFilters(activity, filter)}
          ${scope === "empty-active"
            ? html`<p class="activity-empty">Nothing running right now.</p>`
            : null}
          ${entries.map((entry) => this.renderActivityEntry(entry))}
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
          class="subagent-row status-${row.status} subagent-open-${String(entry.index)}"
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
          class="subagent-row status-${row.status} subagent-run-${String(entry.index)}"
          title=${row.run.task ?? row.run.agent}
          aria-label=${row.ariaLabel}
          @click=${() => { this.onOpenSubagentRun?.(row.run); }}
        >
          <span class="subagent-dot ${row.status}" aria-hidden="true"></span>
          <span class="subagent-kind" aria-hidden="true">Agent</span>
          <span class="subagent-id" dir="ltr">${row.run.agent}</span>
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
          ${inbox.notifications.map((notification) => {
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
    return transcriptWithPendingInQueueOrder(this.messages, [...this.clientQueuedMessages, ...(this.status?.queuedMessages ?? [])]);
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
        <span class="activity-text">${this.activityText(state)}</span>
        ${elapsed === undefined ? null : html`<span class="activity-elapsed" aria-hidden="true">${elapsed.text}</span>`}
      </div>
    `;
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
   * transcript of check marks would be noise.
   */
  private renderDeliveryMark(message: ChatLine) {
    const delivery = message.meta?.delivery;
    if (delivery === undefined) return null;
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
      // A run that stopped after a tool call, owing a reply, is not the same
      // thing as a run that finished; showing both as "idle" hid the failure.
      if (turnEndedUnanswered(this.messages)) return "stalled";
      return "idle";
    }
    if (isWaitingForUser(this.status)) return "asking";
    return "working";
  }

  private activityText(state: string): string {
    if (this.activityCategory(state) === "stalled") return "ended without a reply";
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
    return null;
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
  ariaLabel: string;
}

/**
 * A row per subagent-tool run. The detail line answers the question the list
 * exists for: a running child shows the step it is on, a finished one shows
 * what it was asked to do, because that is what makes its output worth opening.
 */
export function subagentRunRows(runs: readonly SessionSubagentRunInfo[]): SubagentRunRow[] {
  return runs.map((run) => {
    const statusLabel = run.status === "running" ? "Running" : run.status === "done" ? "Done" : run.status === "failed" ? "Failed" : run.status === "lost" ? "Stopped" : "Unknown";
    const duration = subagentRunDuration(run.elapsedMs);
    const detail = run.status === "running" ? run.lastActivity ?? "working" : run.task ?? "";
    return {
      run,
      status: run.status === "lost" ? "failed" : run.status,
      statusLabel,
      duration,
      detail,
      ariaLabel: `${statusLabel} ${run.agent} subagent, ${duration}${detail === "" ? "" : `, ${detail}`}`,
    };
  });
}

export interface BackgroundTaskRow {
  task: SessionBackgroundTaskInfo;
  /** Collapsed to the three states a strip can show, from the tool's larger vocabulary. */
  status: "running" | "done" | "failed" | "unknown";
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
    const status = task.status === "running" ? "running"
      : task.status === "completed" ? "done"
      : task.status === "failed" || task.status === "killed" || task.status === "lost" ? "failed"
      : "unknown";
    const statusLabel = task.status === "completed" ? "Done"
      : task.status === "running" ? "Running"
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

export type TopDrawerTab = "activity" | "notifications";

/** One row of the activity list, tagged with the kind its filter chip names. */
export type ActivityListEntry =
  | { kind: "subagents"; index: number; status: string; startedAt?: string | undefined; row: SubagentRow }
  | { kind: "runs"; index: number; status: string; startedAt?: string | undefined; row: SubagentRunRow }
  | { kind: "tasks"; index: number; status: string; startedAt?: string | undefined; row: BackgroundTaskRow };

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
export function isActiveActivityStatus(status: string): boolean {
  return status === "working" || status === "running";
}

/** Terminal only. A subagent rests at "idle" between turns, so idle is not finished. */
export function isFinishedActivityStatus(status: string): boolean {
  return status === "done" || status === "failed" || status === "error" || status === "lost";
}

/**
 * The tab's own label. A chat that has run forty tasks and is running two says
 * so: the number that matters is what is live, not the size of the history.
 */
export function activityTabLabel(counts: { active: number; total: number }): string {
  return counts.active > 0 ? `Activity · ${String(counts.active)} running` : `Activity (${String(counts.total)})`;
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
const ACTIVITY_TAB_HINT = "Work this chat started in the background: subagents, agent tool runs and terminal tasks. Open one to read its output.";

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

export function topDrawerStartsOpen(attention: { working: boolean; failed: boolean; notifications: boolean }): boolean {
  return attention.working || attention.failed || attention.notifications;
}

/** What the drawer renders for the activity section, derived once. */
export interface ActivityPanelState {
  rows: SubagentRow[];
  runRows: SubagentRunRow[];
  taskRows: BackgroundTaskRow[];
  summary: { label: string; working: boolean; failed: boolean };
  total: number;
  /** How many of those are happening now, which is what the tab reports. */
  activeCount: number;
}

/**
 * Which drawer section to show. The reader's last choice wins while it still
 * has something in it; otherwise the drawer falls back to whichever section
 * exists, so a section that empties out cannot leave a blank drawer behind.
 */
export function selectedTopDrawerTab(available: { activity: boolean; notifications: boolean }, preferred: TopDrawerTab | undefined): TopDrawerTab {
  if (preferred === "activity" && available.activity) return "activity";
  if (preferred === "notifications" && available.notifications) return "notifications";
  return available.notifications ? "notifications" : "activity";
}

/**
 * One-line census of the activity section, so a folded drawer still answers
 * the only question a folded drawer has to answer: is anything still running,
 * and how much finished work is waiting to be opened.
 */
export function activityStripSummary(statuses: readonly string[]): { label: string; working: boolean; failed: boolean } {
  const running = statuses.filter((status) => status === "working" || status === "running").length;
  const failed = statuses.filter((status) => status === "error" || status === "failed").length;
  const finished = statuses.length - running - failed;
  const parts: string[] = [];
  if (running > 0) parts.push(`${String(running)} running`);
  if (failed > 0) parts.push(`${String(failed)} failed`);
  if (finished > 0) parts.push(`${String(finished)} done`);
  return { label: parts.join(" \u00b7 "), working: running > 0, failed: failed > 0 };
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
