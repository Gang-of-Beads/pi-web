import { isRecord } from "../../../shared/unknownValues";
import { machineIdFromUrl } from "./transportHealth";
import { MACHINE_READ_DEADLINE_MS, NetworkError, RequestTimeoutError } from "./requestDeadline";

/** A Machines list check, or a read the page makes on its own about a machine. */
export type MachineReadKind = "check" | "read";

export interface GatedRead {
  readonly url: string;
  readonly kind: MachineReadKind;
  /** The caller's cancellation: a read cancelled while it waits leaves the queue without going on the wire. */
  readonly signal?: AbortSignal | null | undefined;
  /** Called when the read goes on the wire, where its deadline starts counting. */
  readonly onWire?: (() => void) | undefined;
}

interface GateDependencies {
  /** The protocol the page itself came over (`nextHopProtocol`). */
  protocol?: () => string;
  now?: () => number;
}

/** Over HTTP/1.x a browser opens six connections to a host; the page's own machine reads leave the reader at least two. */
const HTTP1_WIRE_LIMIT = 4;
const MULTIPLEXED_PROTOCOLS: ReadonlySet<string> = new Set(["h2", "h3"]);

/** How long a machine whose read ended on the machine read deadline gets no new background reads on the wire. */
const UNANSWERED_PAUSE_MS = 30_000;

/** Whether a machine answers, as far as this page last saw. */
type MachineAnswer = "answering" | "unanswered";

/** What a new read about a machine does: wait for the wire, or end at once as no answer. */
type Admission = "wait" | "no-answer";

const ADMISSION: Readonly<Record<MachineAnswer, Readonly<Record<MachineReadKind, Admission>>>> = {
  answering: { check: "wait", read: "wait" },
  unanswered: { check: "wait", read: "no-answer" },
};

/** How a read on the wire ended, for what it says about its machine. */
type WireEnd = "answered" | "deadline" | "unknown";

function machineAnswer(unansweredSince: number | undefined, now: number): MachineAnswer {
  return unansweredSince !== undefined && now - unansweredSince < UNANSWERED_PAUSE_MS ? "unanswered" : "answering";
}

/** Any answer, a refusal included, says the machine answers; a cancellation or a failed link says nothing about it. */
function failedWireEnd(error: unknown, cancelled: boolean): WireEnd {
  if (cancelled || error instanceof NetworkError) return "unknown";
  return error instanceof RequestTimeoutError ? "deadline" : "answered";
}

/** A read cancelled before it went on the wire ends as the caller's own abort. */
function cancellation(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException("The read was cancelled.", "AbortError");
}

function navigationProtocol(): string {
  if (typeof performance === "undefined" || typeof performance.getEntriesByType !== "function") return "";
  const entry: unknown = performance.getEntriesByType("navigation")[0];
  return isRecord(entry) && typeof entry["nextHopProtocol"] === "string" ? entry["nextHopProtocol"] : "";
}

interface WaitingRead {
  readonly machineId: string;
  readonly kind: MachineReadKind;
  readonly go: () => void;
  readonly endUnanswered: () => void;
}

/**
 * Keeps what the page reads on its own about machines from taking the connections the reader needs
 * (r156 part 3). Measured on plain http with three machines that do not answer: six background
 * reads about them (sessions/unread, session-pins) held every HTTP/1.1 connection the browser opens
 * to the server for 8 s, and Go to offered Files only after 9.8 s. So one read per machine is on the
 * wire at a time, at most four in all over HTTP/1.x, and a machine whose read ended on the machine
 * read deadline gets no new background reads on the wire for `UNANSWERED_PAUSE_MS`; its checks
 * still go, so the Machines list sees it come back, and any answer from it ends the pause.
 */
export class MachineReadGate {
  private readonly waiting: WaitingRead[] = [];
  private readonly onWire = new Set<string>();
  private readonly unansweredSince = new Map<string, number>();
  private readonly protocol: () => string;
  private readonly now: () => number;
  private wireLimit: number | undefined;

  constructor(dependencies: GateDependencies = {}) {
    this.protocol = dependencies.protocol ?? navigationProtocol;
    this.now = dependencies.now ?? (() => performance.now());
  }

  send<T>(read: GatedRead, start: () => Promise<T>): Promise<T> {
    const machineId = machineIdFromUrl(read.url) ?? "local";
    const signal = read.signal ?? undefined;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(cancellation(signal));
        return;
      }
      const noAnswer = (): void => { reject(new RequestTimeoutError(read.url, MACHINE_READ_DEADLINE_MS)); };
      if (ADMISSION[machineAnswer(this.unansweredSince.get(machineId), this.now())][read.kind] === "no-answer") {
        noAnswer();
        return;
      }
      const leave = (): void => {
        this.dequeue(entry);
        reject(cancellation(signal));
      };
      const entry: WaitingRead = {
        machineId,
        kind: read.kind,
        go: () => {
          signal?.removeEventListener("abort", leave);
          const flight = start();
          read.onWire?.();
          flight.then(
            () => { this.ended(machineId, "answered"); },
            (error: unknown) => { this.ended(machineId, failedWireEnd(error, signal?.aborted === true)); },
          );
          resolve(flight);
        },
        endUnanswered: () => {
          signal?.removeEventListener("abort", leave);
          noAnswer();
        },
      };
      signal?.addEventListener("abort", leave, { once: true });
      this.waiting.push(entry);
      this.admit();
    });
  }

  private readonly afterWire: Readonly<Record<WireEnd, (machineId: string) => void>> = {
    answered: (machineId) => { this.unansweredSince.delete(machineId); },
    deadline: (machineId) => {
      this.unansweredSince.set(machineId, this.now());
      for (const entry of this.waiting.filter((waiting) => waiting.machineId === machineId && waiting.kind === "read")) {
        this.dequeue(entry);
        entry.endUnanswered();
      }
    },
    unknown: () => undefined,
  };

  private ended(machineId: string, end: WireEnd): void {
    this.onWire.delete(machineId);
    this.afterWire[end](machineId);
    this.admit();
  }

  /** The oldest waiting read whose machine has nothing on the wire goes next, checks first. */
  private admit(): void {
    while (this.onWire.size < this.limit()) {
      const free = (entry: WaitingRead): boolean => !this.onWire.has(entry.machineId);
      const next = this.waiting.find((entry) => entry.kind === "check" && free(entry)) ?? this.waiting.find(free);
      if (next === undefined) return;
      this.dequeue(next);
      this.onWire.add(next.machineId);
      next.go();
    }
  }

  private limit(): number {
    this.wireLimit ??= MULTIPLEXED_PROTOCOLS.has(this.protocol()) ? Number.POSITIVE_INFINITY : HTTP1_WIRE_LIMIT;
    return this.wireLimit;
  }

  private dequeue(entry: WaitingRead): void {
    const index = this.waiting.indexOf(entry);
    if (index >= 0) this.waiting.splice(index, 1);
  }
}

/** The page's one gate: every background machine read and every Machines list check goes through it. */
export const machineReadGate = new MachineReadGate();
