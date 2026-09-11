import { normalizeMessages } from "./chatMessages";
import { applyTranscriptEvent, seedStreamingPartial } from "./chatTranscript";
import { mergeChatHistory, readChatHistoryCache, removeChatHistoryCache, writeChatHistoryCache, type RawMessagePage } from "./chatHistoryCache";
import type { ChatLine } from "./components/shared";
import type { SessionUiEvent } from "./sessionSocket";

export interface ChatTranscriptView {
  messages: ChatLine[];
  messagePageStart: number;
  // End offset in the raw transcript. Normalization may coalesce multiple raw
  // entries into one displayed chat message, especially tool calls/results.
  messagePageEnd: number;
  messagePageTotal: number;
}

export const MAX_IN_MEMORY_TRANSCRIPTS = 12;

/**
 * The merged in-memory span is capped so a long walk through history cannot
 * pin ten thousand rendered rows to the DOM. The full span still reaches the
 * persisted cache, so an evicted side reloads from the cache, not the wire.
 */
export const TRANSCRIPT_SPAN_CAP = 400;

export interface ChatHistoryCacheAdapter {
  read(sessionId: string): RawMessagePage | undefined;
  write(sessionId: string, page: RawMessagePage): void;
  remove?(sessionId: string): void;
}

const browserChatHistoryCache: ChatHistoryCacheAdapter = {
  read: readChatHistoryCache,
  write: writeChatHistoryCache,
  remove: removeChatHistoryCache,
};

export class ChatTranscriptStore {
  private readonly rawHistoryPages = new Map<string, RawMessagePage>();
  private readonly maxInMemoryTranscripts: number;

  constructor(
    private readonly cache: ChatHistoryCacheAdapter = browserChatHistoryCache,
    options: { maxInMemoryTranscripts?: number } = {},
  ) {
    this.maxInMemoryTranscripts = Math.max(1, options.maxInMemoryTranscripts ?? MAX_IN_MEMORY_TRANSCRIPTS);
  }

  cachedView(sessionId: string): ChatTranscriptView {
    return transcriptViewFromHistory(this.rawHistoryPage(sessionId));
  }

  mergeHistory(sessionId: string, page: RawMessagePage): ChatTranscriptView {
    const existing = this.rawHistoryPage(sessionId);
    const history = mergeChatHistory(existing, page);
    // When the incoming page reaches the existing bottom the reader is
    // anchored at the live tail, so the far side is the oldest rows; a page
    // above the span means the reader is walking history, and the bottom
    // (newest, live-appended) side is the one to let go.
    const incomingReachesBottom = existing === undefined
      || page.start + page.messages.length >= existing.start + existing.messages.length;
    const bounded = capTranscriptSpan(history, incomingReachesBottom ? "top" : "bottom");
    this.cache.write(sessionId, history);
    this.remember(sessionId, bounded);
    return transcriptViewFromHistory(bounded);
  }

  applyLiveEvent(messages: ChatLine[], event: SessionUiEvent): ChatLine[] | undefined {
    return applyTranscriptEvent(messages, event);
  }

  /**
   * Seed the join-time in-flight partial assistant message on top of the
   * committed history view. Returns a new in-memory message list; the raw
   * history cache is deliberately untouched so the partial never persists.
   */
  seedStreamingPartial(messages: ChatLine[], partial: unknown): ChatLine[] {
    return seedStreamingPartial(messages, partial);
  }

  discard(sessionId: string): void {
    this.rawHistoryPages.delete(sessionId);
    this.cache.remove?.(sessionId);
  }

  rawHistoryPage(sessionId: string): RawMessagePage | undefined {
    const inMemory = this.rawHistoryPages.get(sessionId);
    if (inMemory !== undefined) {
      this.remember(sessionId, inMemory);
      return inMemory;
    }
    const persisted = this.cache.read(sessionId);
    if (persisted !== undefined) this.remember(sessionId, persisted);
    return persisted;
  }

  /** Keep recently selected transcripts hot without retaining every visit forever. */
  private remember(sessionId: string, page: RawMessagePage): void {
    this.rawHistoryPages.delete(sessionId);
    this.rawHistoryPages.set(sessionId, page);
    while (this.rawHistoryPages.size > this.maxInMemoryTranscripts) {
      const oldest = this.rawHistoryPages.keys().next().value;
      if (oldest === undefined) return;
      this.rawHistoryPages.delete(oldest);
    }
  }
}

/**
 * Keep at most `TRANSCRIPT_SPAN_CAP` raw entries in memory, dropping the far
 * side from the reader's current focus. Dropped rows survive in the persisted
 * cache written by the caller, and the view's start/end offsets keep the
 * existing "load earlier" and the new "load newer" boundaries honest.
 */
export function capTranscriptSpan(history: RawMessagePage, trimSide: "top" | "bottom"): RawMessagePage {
  if (history.messages.length <= TRANSCRIPT_SPAN_CAP) return history;
  const dropped = history.messages.length - TRANSCRIPT_SPAN_CAP;
  return trimSide === "top"
    ? { start: history.start + dropped, total: history.total, messages: history.messages.slice(dropped) }
    : { start: history.start, total: history.total, messages: history.messages.slice(0, TRANSCRIPT_SPAN_CAP) };
}

export function transcriptViewFromHistory(history: RawMessagePage | undefined): ChatTranscriptView {
  const start = history?.start ?? 0;
  return {
    messages: normalizeMessages(history?.messages ?? []),
    messagePageStart: start,
    messagePageEnd: start + (history?.messages.length ?? 0),
    messagePageTotal: history?.total ?? 0,
  };
}
