import type { ReactiveController, ReactiveControllerHost } from "lit";
import { api, type Machine, type MachineRuntime } from "../api";
import { CHECKING_REACHABILITY, type MachineReachabilityView } from "../machineReachability";
import { machineProbeView, runtimeAvailability } from "../machineAvailability";
import { REQUEST_TIMEOUT_MS } from "../api/requestDeadline";
import { TRANSIENT_GRACE_MS } from "../components/bannerHold";
import { classifyReadError, QUIET_WINDOW_MS, retryDelayMs } from "../sync/readPhase";
import type { ResourceClock } from "../sync/scopedResource";
import { describeError } from "../notice";

interface Probe {
  readonly key: string;
  readonly machine: Machine;
  result: MachineReachabilityView | undefined;
  since: number | undefined;
  attempt: number;
  request: AbortController | undefined;
  cancelRead: (() => void) | undefined;
  cancelPhase: (() => void) | undefined;
}

interface ProbeDependencies {
  read?: (machineId: string, signal: AbortSignal) => Promise<MachineRuntime>;
  clock?: ResourceClock;
}

function targetKey(machine: Machine): string {
  return JSON.stringify([machine.id, machine.kind, machine.connectFrom, machine.baseUrl, machine.updatedAt]);
}

/** Owns only visible Machines-list probes; abandoning this view never cancels session work. */
export class MachineProbeController implements ReactiveController {
  private readonly owners = new Set<object>();
  private readonly probes = new Map<string, Probe>();
  private readonly read: NonNullable<ProbeDependencies["read"]>;
  private readonly clock: ResourceClock;
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
    this.stop();
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

  view(machine: Machine): MachineReachabilityView {
    if (!this.active()) return CHECKING_REACHABILITY;
    const probe = this.probes.get(machine.id);
    if (probe?.key !== targetKey(machine)) return CHECKING_REACHABILITY;
    return machineProbeView(probe.result, probe.since, this.clock.now(), machine);
  }

  private active(): boolean {
    return !this.disconnected && this.owners.size > 0;
  }

  private reconcile(): void {
    if (!this.active()) {
      this.stop();
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
      if (this.probes.has(machine.id)) continue;
      const probe: Probe = { key: targetKey(machine), machine, result: undefined, since: undefined, attempt: 0, request: undefined, cancelRead: undefined, cancelPhase: undefined };
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
    probe.since ??= this.clock.now();
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
      if (this.current(probe)) {
        probe.cancelRead = this.clock.setTimer(() => { void this.check(probe); }, delay);
        this.host.requestUpdate();
      }
    }
  }

  private settle(probe: Probe, result: Probe["result"]): void {
    probe.result = result;
    if (result === undefined) return;
    probe.since = undefined;
    probe.cancelPhase?.();
    probe.cancelPhase = undefined;
  }

  private schedulePhase(probe: Probe): void {
    probe.cancelPhase?.();
    probe.cancelPhase = undefined;
    const since = probe.since;
    if (since === undefined) return;
    const now = this.clock.now();
    const deadline = [TRANSIENT_GRACE_MS, REQUEST_TIMEOUT_MS].map((delay) => since + delay).find((time) => time > now);
    if (deadline === undefined) return;
    probe.cancelPhase = this.clock.setTimer(() => {
      if (!this.current(probe)) return;
      this.host.requestUpdate();
      this.schedulePhase(probe);
    }, deadline - now);
  }

  private cancel(probe: Probe): void {
    probe.cancelRead?.();
    probe.cancelPhase?.();
    probe.request?.abort();
  }

  private stop(): void {
    for (const probe of this.probes.values()) this.cancel(probe);
    this.probes.clear();
  }
}
