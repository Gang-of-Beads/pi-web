import { isRecord } from "../../../shared/unknownValues";
import { machineIdFromUrl } from "./transportHealth";
import { MACHINE_READ_DEADLINE_MS, RequestTimeoutError } from "./requestDeadline";

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
}

/** Over HTTP/1.x a browser opens six connections to a host; the page's own machine reads leave the reader at least two. */
const HTTP1_WIRE_LIMIT = 4;
const MULTIPLEXED_PROTOCOLS: ReadonlySet<string> = new Set(["h2", "h3"]);

/** How a read on the wire ended, for what it says to its machine's waiting reads. */
type WireEnd = "deadline" | "other";

/** Only a read that ran out of the machine read deadline ends its machine's waiting reads; a cancellation never does. */
function wireEnd(error: unknown, cancelled: boolean): WireEnd {
  return !cancelled && error instanceof RequestTimeoutError ? "deadline" : "other";
}

/** A read cancelled before it went on the wire ends as the caller's own abort. */
function cancellation(signal: AbortSignal | undefined): Error {
  const reason: unknown = signal?.reason;
  return reason instanceof Error ? reason : new DOMException("The read was cancelled.", "AbortError");
}

/** Puts a read on the wire; an `onWire` or a `start` that throws ends the read with that error. */
export function launch<T>(read: GatedRead, start: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    read.onWire?.();
    resolve(start());
  });
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
 * to the server for 8 s, and Go to offered Files only after 9.8 s. So over HTTP/1.x one read per
 * machine is on the wire at a time and at most four in all, and a read that ends on the machine read
 * deadline ends its machine's waiting background reads at once; its checks keep waiting, so the
 * Machines list still sees it come back. Every other read waits for the wire. A page that came over
 * HTTP/2 or HTTP/3 has no per-host connection limit, so there the gate sends every read at once.
 */
export class MachineReadGate {
  private readonly waiting: WaitingRead[] = [];
  private readonly onWire = new Set<string>();
  private readonly protocol: () => string;
  private multiplexedPage: boolean | undefined;

  constructor(dependencies: GateDependencies = {}) {
    this.protocol = dependencies.protocol ?? navigationProtocol;
  }

  send<T>(read: GatedRead, start: () => Promise<T>): Promise<T> {
    if (this.multiplexed()) return launch(read, start);
    const machineId = machineIdFromUrl(read.url) ?? "local";
    const signal = read.signal ?? undefined;
    return new Promise<T>((resolve, reject) => {
      if (signal?.aborted === true) {
        reject(cancellation(signal));
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
          const flight = launch(read, start);
          flight.then(
            () => { this.ended(machineId, "other"); },
            (error: unknown) => { this.ended(machineId, wireEnd(error, signal?.aborted === true)); },
          );
          resolve(flight);
        },
        endUnanswered: () => {
          signal?.removeEventListener("abort", leave);
          reject(new RequestTimeoutError(read.url, MACHINE_READ_DEADLINE_MS));
        },
      };
      signal?.addEventListener("abort", leave, { once: true });
      this.waiting.push(entry);
      this.admit();
    });
  }

  private readonly afterWire: Readonly<Record<WireEnd, (machineId: string) => void>> = {
    deadline: (machineId) => {
      for (const entry of this.waiting.filter((waiting) => waiting.machineId === machineId && waiting.kind === "read")) {
        this.dequeue(entry);
        entry.endUnanswered();
      }
    },
    other: () => undefined,
  };

  private ended(machineId: string, end: WireEnd): void {
    this.onWire.delete(machineId);
    this.afterWire[end](machineId);
    this.admit();
  }

  /** The oldest waiting read whose machine has nothing on the wire goes next, checks first. */
  private admit(): void {
    while (this.onWire.size < HTTP1_WIRE_LIMIT) {
      const free = (entry: WaitingRead): boolean => !this.onWire.has(entry.machineId);
      const next = this.waiting.find((entry) => entry.kind === "check" && free(entry)) ?? this.waiting.find(free);
      if (next === undefined) return;
      this.dequeue(next);
      this.onWire.add(next.machineId);
      next.go();
    }
  }

  /** Read once: the protocol the page came over does not change while it lives. */
  private multiplexed(): boolean {
    this.multiplexedPage ??= MULTIPLEXED_PROTOCOLS.has(this.protocol());
    return this.multiplexedPage;
  }

  private dequeue(entry: WaitingRead): void {
    const index = this.waiting.indexOf(entry);
    if (index >= 0) this.waiting.splice(index, 1);
  }
}

/** The page's one gate: every background machine read and every Machines list check goes through it. */
export const machineReadGate = new MachineReadGate();
