import type { ReactiveController, ReactiveControllerHost } from "lit";
import { api, type Machine, type MachineRuntime } from "../api";
import { CHECKING_REACHABILITY, type MachineReachabilityView } from "../machineReachability";
import { confirmedReachability, machineProbeReading, runtimeAvailability, type MachineReachabilityReading } from "../machineAvailability";
import { browserMachineReachabilityMemory, type MachineReachabilityMemory } from "../machineReachabilityMemory";
import { resolveAppUrl } from "../appUrl";
import { REQUEST_TIMEOUT_MS } from "../api/requestDeadline";
import { TRANSIENT_GRACE_MS } from "../components/bannerHold";
import { classifyReadError, QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";
import type { ResourceClock } from "../sync/scopedResource";
import { describeError } from "../notice";

interface Probe {
  readonly key: string;
  readonly machine: Machine;
  /** Whether the machine answered since this probe last started checking (its creation or a return to the list). */
  answered: boolean;
  result: MachineReachabilityView | undefined;
  unansweredSince: number | undefined;
  /** Whether a check since the last answer concluded without one, as opposed to being aborted by a pause. */
  unansweredSeen: boolean;
  attempt: number;
  request: AbortController | undefined;
  cancelRead: (() => void) | undefined;
  cancelPhase: (() => void) | undefined;
  /** When the list paused this probe; its clock stands still until the list returns. */
  pausedAt: number | undefined;
}

interface ProbeDependencies {
  read?: (machineId: string, signal: AbortSignal) => Promise<MachineRuntime>;
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

/** Owns only visible Machines-list probes; abandoning this view never cancels session work. */
export class MachineProbeController implements ReactiveController {
  private readonly owners = new Set<object>();
  private readonly probes = new Map<string, Probe>();
  private readonly read: NonNullable<ProbeDependencies["read"]>;
  private readonly clock: ResourceClock;
  private readonly memory: MachineReachabilityMemory;
  private disconnected = false;

  constructor(private readonly host: ReactiveControllerHost, private readonly machines: () => readonly Machine[], dependencies: ProbeDependencies = {}) {
    this.read = dependencies.read ?? ((id, signal) => api.runtime(id, true, { signal, observation: "isolated" }));
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
  }

  hostUpdated(): void {
    this.reconcile();
  }

  hostDisconnected(): void {
    this.disconnected = true;
    this.owners.clear();
    this.pause();
  }

  setVisible(owner: object, visible: boolean): void {
    if (visible) this.owners.add(owner);
    else this.owners.delete(owner);
    this.reconcile();
    this.host.requestUpdate();
  }

  wake(): void {
    for (const probe of this.probes.values()) {
      probe.attempt = 0;
      void this.check(probe);
    }
  }

  /** What the Machines lists show: this page's answer, else the last state this browser confirmed for the same target. */
  view(machine: Machine): MachineReachabilityView {
    return this.reading(machine).view;
  }

  /** Only what this page confirmed while it is checking; a remembered state, or anything while the checks are paused, reads as checking. */
  confirmedView(machine: Machine): MachineReachabilityView {
    if (!this.active()) return CHECKING_REACHABILITY;
    return confirmedReachability(this.reading(machine));
  }

  /** A removed machine's remembered state goes with it. */
  forget(machine: Machine): void {
    this.memory.forget(machine.id);
  }

  private reading(machine: Machine): MachineReachabilityReading {
    const probe = this.probes.get(machine.id);
    const current = probe?.key === targetKey(machine) ? probe : undefined;
    return machineProbeReading(current, current?.pausedAt ?? this.clock.now(), machine, this.memory.recall(machine.id, rememberedTarget(machine)));
  }

  private active(): boolean {
    return !this.disconnected && this.owners.size > 0;
  }

  private reconcile(): void {
    if (!this.active()) {
      this.pause();
      return;
    }
    const targets = new Map(this.machines().map((machine) => [machine.id, machine]));
    for (const [id, probe] of this.probes) {
      const machine = targets.get(id);
      if (machine !== undefined && probe.key === targetKey(machine)) continue;
      this.cancel(probe);
      this.probes.delete(id);
    }
    for (const machine of targets.values()) {
      const existing = this.probes.get(machine.id);
      if (existing !== undefined) {
        this.resume(existing);
        continue;
      }
      const probe: Probe = { key: targetKey(machine), machine, answered: false, result: undefined, unansweredSince: undefined, unansweredSeen: false, attempt: 0, request: undefined, cancelRead: undefined, cancelPhase: undefined, pausedAt: undefined };
      this.probes.set(machine.id, probe);
      void this.check(probe);
    }
  }

  private current(probe: Probe): boolean {
    return this.active() && this.probes.get(probe.machine.id) === probe && this.machines().some((machine) => targetKey(machine) === probe.key);
  }

  private async check(probe: Probe): Promise<void> {
    if (!this.current(probe) || probe.request !== undefined) return;
    probe.cancelRead?.();
    probe.cancelRead = undefined;
    const request = new AbortController();
    probe.request = request;
    probe.unansweredSince ??= this.clock.now();
    this.schedulePhase(probe);
    this.host.requestUpdate();
    let delay = QUIET_WINDOW_MS;
    try {
      const runtime = await this.read(probe.machine.id, request.signal);
      if (!this.current(probe) || request.signal.aborted) return;
      const result = runtimeAvailability(runtime);
      this.settle(probe, result.state === "offline" ? undefined : result);
      if (result.state === "online") probe.attempt = 0;
      else delay = retryDelayMs(probe.attempt++, QUIET_WINDOW_MS);
    } catch (error) {
      if (!this.current(probe) || request.signal.aborted) return;
      const outcome = classifyReadError(error);
      this.settle(probe, error instanceof SyntaxError || outcome.kind === "fact" || outcome.miss.kind === "server-error" ? { state: "error", text: describeError(error) } : undefined);
      delay = probe.result === undefined ? retryDelayMs(probe.attempt++, QUIET_WINDOW_MS) : QUIET_WINDOW_MS;
    } finally {
      if (probe.request === request) probe.request = undefined;
      if (this.current(probe) && !request.signal.aborted) {
        this.remember(probe);
        probe.cancelRead = this.clock.setTimer(() => { void this.check(probe); }, delay);
        this.host.requestUpdate();
      }
    }
  }

  private settle(probe: Probe, result: Probe["result"]): void {
    probe.result = result;
    if (result === undefined) {
      probe.unansweredSeen = true;
      return;
    }
    probe.answered = true;
    probe.unansweredSeen = false;
    probe.unansweredSince = undefined;
    probe.cancelPhase?.();
    probe.cancelPhase = undefined;
  }

  private remember(probe: Probe): void {
    const now = this.clock.now();
    this.memory.remember(probe.machine.id, rememberedTarget(probe.machine), (remembered) => {
      const reading = machineProbeReading(probe, now, probe.machine, remembered);
      return reading.basis === "confirmed" ? reading.view : undefined;
    });
  }

  private schedulePhase(probe: Probe): void {
    probe.cancelPhase?.();
    probe.cancelPhase = undefined;
    const since = probe.unansweredSince;
    if (since === undefined) return;
    const now = this.clock.now();
    const deadline = [TRANSIENT_GRACE_MS, REQUEST_TIMEOUT_MS].map((delay) => since + delay).find((time) => time > now);
    if (deadline === undefined) return;
    probe.cancelPhase = this.clock.setTimer(() => {
      if (!this.current(probe)) return;
      this.remember(probe);
      this.host.requestUpdate();
      this.schedulePhase(probe);
    }, deadline - now);
  }

  private cancel(probe: Probe): void {
    probe.cancelRead?.();
    probe.cancelRead = undefined;
    probe.cancelPhase?.();
    probe.cancelPhase = undefined;
    probe.request?.abort();
    probe.request = undefined;
  }

  /**
   * Checks pause while the list is hidden (r60). Each probe keeps its answer and its clock, so a
   * Trying seen before the pause is still Trying on return; the answer counts as remembered until
   * the machine answers again (`answered`).
   */
  private pause(): void {
    const now = this.clock.now();
    for (const probe of this.probes.values()) {
      if (probe.pausedAt !== undefined) continue;
      this.cancel(probe);
      probe.pausedAt = now;
    }
  }

  /**
   * The clock carries over a pause only when it measured a real lack of answer: a check that
   * concluded without one, or one that had already reached Trying. A check the pause aborted
   * before that was not unanswered, so the returning check starts its own clock; otherwise short
   * visits to a slow machine would add up to Trying and Offline.
   */
  private resume(probe: Probe): void {
    const pausedAt = probe.pausedAt;
    if (pausedAt === undefined) return;
    const since = probe.unansweredSince;
    const carried = since !== undefined && (probe.unansweredSeen || pausedAt - since >= TRANSIENT_GRACE_MS);
    probe.unansweredSince = carried ? since + this.clock.now() - pausedAt : undefined;
    probe.answered = false;
    probe.pausedAt = undefined;
    probe.attempt = 0;
    void this.check(probe);
  }
}
