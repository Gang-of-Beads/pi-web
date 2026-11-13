import type { ImageContent } from "@earendil-works/pi-ai";
import type { QueuedPromptKind } from "./promptDelivery.js";
import { getProperty, getString, isRecord } from "../../../shared/unknownValues.js";

/**
 * Which accepted message an SDK user message is, decided from the objects pi actually queues.
 *
 * pi's shown queue lists are text. It pushes a steer's text, announces the queue, then queues the
 * message object agent-core will commit, and at commit it drops the first shown entry with the
 * same text - an empty one included. Equal or captionless texts, input-hook rewrites and queued
 * image normalisation all break any reading of those lists as ownership: on SDK 1.5.2 a batch of
 * two photo-only steers lost one sender id and an idle batch swapped them. An owner is bound here
 * only to an object proven to be its: the one user message queued after its handoff began (or
 * the one carrying that handoff's own image references), or the first user message a direct run
 * it started commits that no queue held. Anything else stays unowned; nothing here guesses from
 * text, size or position.
 */

export interface SdkPromptScope {
  readonly sessionId: string;
  readonly cwd: string;
}

export interface SdkPromptOwner {
  readonly scope: SdkPromptScope;
  readonly key: string;
  readonly clientMessageId?: string;
  readonly handedAt: string;
  readonly sentVia?: string;
  readonly sentBy?: string;
}

export type SdkQueueSnapshot = Readonly<Record<QueuedPromptKind, readonly unknown[] | undefined>>;

/** The sender marks an inbox entry carries onto its committed copy. */
export function senderMarks(entry: { readonly sentVia?: string; readonly sentBy?: string }): Pick<SdkPromptOwner, "sentVia" | "sentBy"> {
  return { ...(entry.sentVia === undefined ? {} : { sentVia: entry.sentVia }), ...(entry.sentBy === undefined ? {} : { sentBy: entry.sentBy }) };
}

/** Pending: still in agent-core's queue. Loop-held: drained by the agent loop, which commits it even on abort. */
export type SdkQueuePhase = "pending" | "loop-held" | "unknown";

export interface SdkQueuedPrompt {
  readonly sequence: number;
  readonly kind: QueuedPromptKind;
  readonly message: object;
  readonly owner: SdkPromptOwner | undefined;
  /** Whether pi still lists it: emptying pi's lists hides a loop-held message, which still commits. */
  readonly listed: boolean;
}

export interface SdkQueueTicket {
  readonly kind: QueuedPromptKind;
  readonly owner: SdkPromptOwner;
  readonly afterSequence: number;
  readonly afterClears: number;
  readonly images: ReadonlySet<object>;
}

/**
 * Where a queued handoff's message is once pi says it queued it. `read` also covers a message the agent loop
 * drained before this look while nothing emptied pi's lists: pi queues the object and reports it one microtask
 * apart, only the loop and the daemon's clears (`clearShown`; no extension API empties them) take objects out of
 * the queues, and the loop commits
 * what it drained even when the run is aborted, unless it throws first. After a clear, an object already gone may
 * have been returned instead of read, so that is `unknown`, as is any landing no single object is provably.
 */
export type SdkQueueLanding = "queued" | "read" | "unknown";

export interface SdkPromptRead {
  readonly source: QueuedPromptKind | "direct" | "unknown";
  readonly owner: SdkPromptOwner | undefined;
}

/** A user message committed while a handoff was open; one first seen at its commit has no known lane. */
interface ReadCandidate {
  readonly sequence: number;
  readonly kind: QueuedPromptKind | undefined;
  readonly message: object;
  readonly owner: SdkPromptOwner | undefined;
}

export class SdkPromptQueue {
  private reads = new WeakMap<object, SdkPromptRead>();
  private readonly queued = new Map<object, SdkQueuedPrompt>();
  private readonly recentReads = new Map<object, ReadCandidate>();
  private readonly tickets = new Set<SdkQueueTicket>();
  private direct: SdkPromptOwner | undefined;
  private sequence = 0;
  private clears = 0;
  private readonly unattributed = new Set<string>();

  constructor(readonly scope: SdkPromptScope) {}

  matches(scope: SdkPromptScope): boolean {
    return scope.sessionId === this.scope.sessionId && scope.cwd === this.scope.cwd;
  }

  /**
   * Open a queued handoff. pi announces a queue change before it queues the object, so the
   * owner is bound later, at `finish`, from what appeared after this point.
   */
  begin(kind: QueuedPromptKind, owner: SdkPromptOwner, images: readonly object[], snapshot: SdkQueueSnapshot): SdkQueueTicket {
    if (!this.matches(owner.scope)) throw new Error("SDK prompt owner scope mismatch");
    this.observe(snapshot);
    const ticket = { kind, owner, afterSequence: this.sequence, afterClears: this.clears, images: new Set(images) };
    this.tickets.add(ticket);
    return ticket;
  }

  /** pi said it queued the handoff's message: bind the owner to the one object that can be it, or to none. */
  finish(ticket: SdkQueueTicket, snapshot: SdkQueueSnapshot): SdkQueueLanding {
    if (!this.tickets.delete(ticket)) throw new Error("SDK queue ticket is no longer active");
    this.observe(snapshot);
    const candidates: ReadCandidate[] = [...this.recentReads.values(), ...this.queued.values()]
      .filter((candidate) => (candidate.kind === undefined || candidate.kind === ticket.kind) && candidate.sequence > ticket.afterSequence);
    const imageBound = candidates.filter((candidate) => messageUsesImages(candidate.message, ticket.images));
    const selected = imageBound.length === 1 ? imageBound[0] : candidates.length === 1 ? candidates[0] : undefined;
    if (this.tickets.size === 0) this.recentReads.clear();
    if (candidates.length === 0 && snapshot[ticket.kind] !== undefined && this.clears === ticket.afterClears) return "read";
    if (selected === undefined || selected.owner !== undefined) {
      this.unattributed.add(ticket.owner.key);
      return "unknown";
    }
    const queued = this.queued.get(selected.message);
    if (queued !== undefined) {
      this.queued.set(selected.message, { ...queued, owner: ticket.owner });
      return "queued";
    }
    this.reads.set(selected.message, { source: ticket.kind, owner: ticket.owner });
    return "read";
  }

  cancel(ticket: SdkQueueTicket): void {
    this.tickets.delete(ticket);
    if (this.tickets.size === 0) this.recentReads.clear();
  }

  /** A handoff the runtime did not take: neither its ticket nor its direct run may bind anything. */
  cancelOwner(key: string): void {
    for (const ticket of this.tickets) if (ticket.owner.key === key) this.cancel(ticket);
    if (this.direct?.key === key) this.direct = undefined;
  }

  /** A direct run started for this owner: the first user message it commits that no queue held is its own. */
  startDirect(owner: SdkPromptOwner): void {
    if (!this.matches(owner.scope)) throw new Error("SDK direct prompt scope mismatch");
    this.direct = owner;
  }

  /** The direct run settled: an owner whose message never committed must not label a later one. */
  endDirect(owner: SdkPromptOwner): void {
    if (this.direct === owner) this.direct = undefined;
  }

  observe(snapshot: SdkQueueSnapshot): void {
    for (const kind of ["steer", "followUp"] satisfies readonly QueuedPromptKind[]) {
      const pending = snapshot[kind];
      if (pending === undefined) continue;
      for (const message of pending) {
        if (!isRecord(message) || message["role"] !== "user" || this.queued.has(message) || this.reads.has(message)) continue;
        this.queued.set(message, { sequence: ++this.sequence, kind, message, owner: undefined, listed: true });
      }
    }
  }

  /**
   * The agent commits a user message. A message queued and committed between two looks is first
   * seen here; while a handoff is open it stays a candidate for that handoff's `finish`.
   */
  read(message: object): SdkPromptRead {
    const prior = this.reads.get(message);
    if (prior !== undefined) return prior;
    const prompt = this.queued.get(message);
    this.queued.delete(message);
    const direct = prompt === undefined ? this.direct : undefined;
    if (direct !== undefined) this.direct = undefined;
    if (this.tickets.size > 0 && direct === undefined) this.recentReads.set(message, prompt ?? { sequence: ++this.sequence, kind: undefined, message, owner: undefined });
    const read: SdkPromptRead = prompt !== undefined
      ? { source: prompt.kind, owner: prompt.owner }
      : direct === undefined ? { source: "unknown", owner: undefined } : { source: "direct", owner: direct };
    this.reads.set(message, read);
    return read;
  }

  partition(snapshot: SdkQueueSnapshot): Record<SdkQueuePhase, SdkQueuedPrompt[]> {
    this.observe(snapshot);
    const result: Record<SdkQueuePhase, SdkQueuedPrompt[]> = { pending: [], "loop-held": [], unknown: [] };
    const pending = {
      steer: snapshot.steer === undefined ? undefined : new Set(snapshot.steer),
      followUp: snapshot.followUp === undefined ? undefined : new Set(snapshot.followUp),
    };
    for (const prompt of this.queued.values()) {
      const lane = pending[prompt.kind];
      const phase: SdkQueuePhase = lane === undefined ? "unknown" : lane.has(prompt.message) ? "pending" : "loop-held";
      result[phase].push(prompt);
    }
    return result;
  }

  /** What pi lists as waiting, steering lane first, each lane in the order it was queued. */
  shown(snapshot: SdkQueueSnapshot): SdkQueuedPrompt[] {
    this.observe(snapshot);
    const laneOrder: Record<QueuedPromptKind, number> = { steer: 0, followUp: 1 };
    return [...this.queued.values()].filter((prompt) => prompt.listed).sort((left, right) => laneOrder[left.kind] - laneOrder[right.kind] || left.sequence - right.sequence);
  }

  /**
   * pi's lists were emptied, from a snapshot taken just before: pending messages leave and are
   * returned; loop-held ones stay, unlisted, so their commit is still stamped with their owner.
   */
  clearShown(snapshot: SdkQueueSnapshot): SdkQueuedPrompt[] {
    this.clears += 1;
    const pending = this.partition(snapshot).pending;
    for (const prompt of pending) this.queued.delete(prompt.message);
    for (const [message, prompt] of this.queued) this.queued.set(message, { ...prompt, listed: false });
    return pending;
  }

  /**
   * The owner keys of this runtime's `unknown` landings since the last call. They live with the runtime's
   * queue, so a later runtime of the same session never ends a row that runtime handed again.
   */
  takeUnattributed(): string[] {
    const keys = [...this.unattributed];
    this.unattributed.clear();
    return keys;
  }

  forget(): void {
    this.queued.clear();
    this.recentReads.clear();
    this.tickets.clear();
    this.unattributed.clear();
    this.direct = undefined;
    this.reads = new WeakMap();
  }
}

export function sdkQueueSnapshot(agent: unknown): SdkQueueSnapshot {
  return { steer: pendingUserMessages(getProperty(agent, "steeringQueue")), followUp: pendingUserMessages(getProperty(agent, "followUpQueue")) };
}

export function sdkQueuedText(message: unknown): string {
  const content = getProperty(message, "content");
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part: unknown) => getProperty(part, "type") === "text").map((part: unknown) => getString(part, "text") ?? "").join("");
}

export function sdkQueuedImages(message: unknown): ImageContent[] {
  const content = getProperty(message, "content");
  if (!Array.isArray(content)) return [];
  return content.flatMap((part: unknown): ImageContent[] => {
    if (getProperty(part, "type") !== "image") return [];
    const data = getString(part, "data");
    const mimeType = getString(part, "mimeType");
    if (data === undefined || mimeType === undefined) throw new Error("Runtime queued image payload is unavailable");
    return [{ type: "image", data, mimeType }];
  });
}

function messageUsesImages(message: unknown, expected: ReadonlySet<object>): boolean {
  const content = getProperty(message, "content");
  if (expected.size === 0 || !Array.isArray(content)) return false;
  const images = content.filter((part: unknown): part is Record<string, unknown> => isRecord(part) && part["type"] === "image");
  return images.length > 0 && images.every((image) => expected.has(image));
}

function pendingUserMessages(queue: unknown): readonly unknown[] | undefined {
  const pending = getProperty(queue, "messages");
  return Array.isArray(pending) ? pending.filter((message: unknown) => getProperty(message, "role") === "user") : undefined;
}
