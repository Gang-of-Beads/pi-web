import type { ReactiveController, ReactiveControllerHost } from "lit";
import { api, type Machine, type MachineRuntime } from "../api";
import { CHECKING_REACHABILITY, reachabilityView, type MachineReachabilityView } from "../machineReachability";
import { runtimeAvailability } from "../machineAvailability";
import { browserMachineReachabilityMemory, type MachineReachabilityMemory } from "../machineReachabilityMemory";
import { resolveAppUrl } from "../appUrl";
import { classifyReadError } from "../sync/readPhase";
import type { ResourceClock } from "../sync/scopedResource";
import { describeError } from "../notice";
import { isRequestTimeout, MACHINE_READ_DEADLINE_MS } from "../api/requestDeadline";

const NO_ANSWER_WORDS = `No answer in ${String((2 * MACHINE_READ_DEADLINE_MS) / 1000)} seconds`;

/**
 * Which check of a round's machine this is (r156). A check waits in the machine read gate
 * (api/machineReadGate.ts) for a connection, and its deadline counts from when it goes on the wire,
 * not from when it was asked for; a first check that got no answer there is checked once more in the
 * same round, and only a retry that gets none reads Offline. An answer, Error included, ends the
 * round's checking at once.
 */
type CheckAttempt = "first" | "retry";

interface Probe {
  readonly key: string;
  readonly machine: Machine;
  request: AbortController | undefined;
  /** This page's last answer for the machine at this target, and when it came. */
  result: MachineReachabilityView | undefined;
  answeredAt: number;
  /** Whether that answer came in since the current round began; an earlier one is remembered, not confirmed. */
  current: boolean;
}

interface ProbeDependencies {
  /** Reads the machine's runtime; calls `onWire` when the read goes on the wire, where the check's deadline starts. */
  read?: (machineId: string, signal: AbortSignal, onWire: () => void) => Promise<MachineRuntime>;
  clock?: ResourceClock;
  memory?: MachineReachabilityMemory;
}

function targetKey(machine: Machine): string {
  return JSON.stringify([machine.id, machine.kind, machine.connectFrom, machine.baseUrl, machine.updatedAt]);
}

/** The target a remembered state belongs to; unlike the probe's key it leaves out the record revision, so a rename keeps the state. */
function rememberedTarget(machine: Machine): string {
  return JSON.stringify([machine.kind, machine.connectFrom, machine.baseUrl]);
}

/** A check that failed: an answer that names a fault is Error, no answer at all is Offline. */
function failureView(error: unknown): MachineReachabilityView {
  const outcome = classifyReadError(error);
  const answered = error instanceof SyntaxError || outcome.kind === "fact" || outcome.miss.kind === "server-error";
  return reachabilityView(answered ? "error" : "offline", describeError(error));
}

/**
 * Checks every listed machine once when something starts to show their states (owner, 2026-10-23):
 * a Machines list coming into view, or a plugin starting to listen to the fleet's machines. A check
 * runs to its end even when the list is left meanwhile, so the next visit opens on its answer, and
 * nothing checks again while the list stays shown: leaving and returning does. A check that got no
 * answer in time is checked once more within its round (`CheckAttempt`). `refresh` checks one
 * machine on request. Abandoning this view never cancels session work.
 */
export class MachineProbeController implements ReactiveController {
  private readonly owners = new Set<object>();
  private readonly probes = new Map<string, Probe>();
  private readonly read: NonNullable<ProbeDependencies["read"]>;
  private readonly clock: NonNullable<ProbeDependencies["clock"]>;
  private readonly memory: MachineReachabilityMemory;
  private disconnected = false;

  constructor(private readonly host: ReactiveControllerHost, private readonly machines: () => readonly Machine[], dependencies: ProbeDependencies = {}) {
    this.read = dependencies.read ?? ((id, signal, onWire) => api.runtime(id, true, { signal, observation: "isolated", onWire }));
    this.clock = dependencies.clock ?? {
      now: () => performance.now(),
      setTimer: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return () => { clearTimeout(timer); };
      },
    };
    this.memory = dependencies.memory ?? browserMachineReachabilityMemory(() => resolveAppUrl(""));
    host.addController(this);
  }

  hostConnected(): void {
    this.disconnected = false;
    if (typeof window !== "undefined") window.addEventListener("pagehide", this.onPageHide);
  }

  hostUpdated(): void {
    this.reconcile();
  }

  hostDisconnected(): void {
    this.disconnected = true;
    this.owners.clear();
    for (const probe of this.probes.values()) this.cancel(probe);
    if (typeof window !== "undefined") window.removeEventListener("pagehide", this.onPageHide);
  }

  /**
   * A page going away (a reload, another address, a closed tab) cuts its checks off, and the browser
   * fails the cut requests after `pagehide`: that failure says nothing about the machines, so the
   * checks are let go first and nothing of them is remembered.
   */
  private readonly onPageHide = (): void => {
    for (const probe of this.probes.values()) this.cancel(probe);
  };

  /** A list or listener starting to show the states checks every machine once; one going away stops nothing. */
  setVisible(owner: object, visible: boolean): void {
    const appeared = visible && !this.owners.has(owner);
    if (visible) this.owners.add(owner);
    else this.owners.delete(owner);
    if (appeared) this.round();
    this.host.requestUpdate();
  }

  /** The browser is back online: a list on screen checks again. */
  wake(): void {
    if (this.active()) this.round();
  }

  /** Check one machine again now, whether or not a list shows it. */
  refresh(machine: Machine): void {
    const probe = this.probeFor(machine);
    probe.current = false;
    void this.check(probe);
  }

  /** What the Machines lists show: this page's answer, else the last state this browser observed for the same target, else nothing. */
  view(machine: Machine): MachineReachabilityView {
    return this.probeOf(machine)?.result ?? this.memory.recall(machine.id, rememberedTarget(machine)) ?? CHECKING_REACHABILITY;
  }

  /**
   * Only an answer of the current round, while a list or listener shows the states, and no older than
   * `maxAgeMs` when given; anything else reads as checking. A round answers once per visit, so a
   * caller that acts on the answer (an instant action's admission) bounds its age: a list left on
   * screen must not refuse on what a machine said long ago.
   */
  confirmedView(machine: Machine, maxAgeMs = Number.POSITIVE_INFINITY): MachineReachabilityView {
    const probe = this.probeOf(machine);
    const result = this.active() && probe?.current === true && this.clock.now() - probe.answeredAt <= maxAgeMs ? probe.result : undefined;
    return result ?? CHECKING_REACHABILITY;
  }

  /** A removed machine's remembered state goes with it. */
  forget(machine: Machine): void {
    this.memory.forget(machine.id);
  }

  private active(): boolean {
    return !this.disconnected && this.owners.size > 0;
  }

  private probeOf(machine: Machine): Probe | undefined {
    const probe = this.probes.get(machine.id);
    return probe?.key === targetKey(machine) ? probe : undefined;
  }

  private probeFor(machine: Machine): Probe {
    const existing = this.probeOf(machine);
    if (existing !== undefined) return existing;
    const replaced = this.probes.get(machine.id);
    if (replaced !== undefined) this.cancel(replaced);
    const probe: Probe = { key: targetKey(machine), machine, request: undefined, result: undefined, answeredAt: 0, current: false };
    this.probes.set(machine.id, probe);
    return probe;
  }

  /** Every listed machine once; a check already under way stands for its machine. */
  private round(): void {
    for (const machine of this.machines()) this.refresh(machine);
  }

  /** Probes follow the machine list: a removed machine or a changed target drops its probe, and while the states are shown a machine new to the list is checked once. */
  private reconcile(): void {
    const targets = new Map(this.machines().map((machine) => [machine.id, machine]));
    for (const [id, probe] of this.probes) {
      const machine = targets.get(id);
      if (machine !== undefined && probe.key === targetKey(machine)) continue;
      this.cancel(probe);
      this.probes.delete(id);
    }
    if (!this.active()) return;
    for (const machine of targets.values()) {
      if (!this.probes.has(machine.id)) this.refresh(machine);
    }
  }

  private async check(probe: Probe, attempt: CheckAttempt = "first"): Promise<void> {
    if (this.disconnected || probe.request !== undefined) return;
    const request = new AbortController();
    probe.request = request;
    let stopDeadline = (): void => undefined;
    const startDeadline = (): void => { stopDeadline = this.clock.setTimer(() => { request.abort(); }, MACHINE_READ_DEADLINE_MS); };
    let view: MachineReachabilityView | undefined;
    try {
      view = runtimeAvailability(await this.read(probe.machine.id, request.signal, startDeadline));
    } catch (error) {
      view = request.signal.aborted || isRequestTimeout(error) ? undefined : failureView(error);
    } finally {
      stopDeadline();
    }
    if (!this.awaits(probe, request)) return;
    probe.request = undefined;
    if (view === undefined) {
      this.unanswered[attempt](probe);
      return;
    }
    this.settle(probe, view);
  }

  /** A check the deadline ended: the first is checked once more, the retry reads Offline. */
  private readonly unanswered: Readonly<Record<CheckAttempt, (probe: Probe) => void>> = {
    first: (probe) => { void this.check(probe, "retry"); },
    retry: (probe) => { this.settle(probe, reachabilityView("offline", NO_ANSWER_WORDS)); },
  };

  private settle(probe: Probe, view: MachineReachabilityView): void {
    probe.result = view;
    probe.answeredAt = this.clock.now();
    probe.current = true;
    this.memory.remember(probe.machine.id, rememberedTarget(probe.machine), view);
    this.host.requestUpdate();
  }

  /** Whether the probe still waits for this check: a cancel (the machine removed or moved, the page gone) let it go. */
  private awaits(probe: Probe, request: AbortController): boolean {
    return probe.request === request;
  }

  private cancel(probe: Probe): void {
    probe.request?.abort();
    probe.request = undefined;
  }
}
