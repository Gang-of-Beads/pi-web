import { piWebApi, type PiWebStatusResponse } from "../api";
import { selectedMachineId, type GetState, type SetState } from "./types";

export interface PiWebStatusControllerDependencies {
  api?: Pick<typeof piWebApi, "piWebStatus" | "checkForUpdates">;
  onRefreshError?: (machineId: string, error: unknown) => void;
  now?: () => number;
}

/** How long an answer serves every reader of a machine's PI WEB status before it is asked again. */
export const PI_WEB_STATUS_FRESH_MS = 30_000;

interface StatusRead {
  flight?: Promise<PiWebStatusResponse>;
  answer?: { at: number; value: PiWebStatusResponse };
}

export class PiWebStatusController {
  private readonly api: Pick<typeof piWebApi, "piWebStatus" | "checkForUpdates">;
  private readonly onRefreshError: (machineId: string, error: unknown) => void;
  private requestSequence = 0;
  private pendingUpdateCheck: { machineId: string; requestSequence: number; promise: Promise<void> } | undefined;
  private readonly now: () => number;
  private readonly reads = new Map<string, StatusRead>();

  constructor(
    private readonly getState: GetState,
    private readonly setState: SetState,
    dependencies: PiWebStatusControllerDependencies = {},
  ) {
    this.api = dependencies.api ?? piWebApi;
    this.onRefreshError = dependencies.onRefreshError ?? (() => undefined);
    this.now = dependencies.now ?? (() => Date.now());
  }

  /**
   * A machine's PI WEB status, read once for every reader (object model §4.7, P7 slice c). The
   * page and the updates plugin each read it at boot, about a second apart, and 8504 answered the
   * same status twice. A read on its way is joined, and an answer younger than
   * `PI_WEB_STATUS_FRESH_MS` is reused. The web process caches this status for 60 s already, so reuse
   * adds at most 30 s of age to an answer the server accepts; "Check for updates" still asks the machine.
   * A forced check's answer replaces the machine's whole entry, so a read still on its way when it
   * lands writes into an entry nobody reads again: the forced answer is the one later readers get.
   */
  read(machineId: string): Promise<PiWebStatusResponse> {
    const entry = this.reads.get(machineId) ?? {};
    this.reads.set(machineId, entry);
    if (entry.flight !== undefined) return entry.flight;
    if (entry.answer !== undefined && this.now() - entry.answer.at < PI_WEB_STATUS_FRESH_MS) return Promise.resolve(entry.answer.value);
    const flight = this.api.piWebStatus(machineId).then((value) => {
      entry.answer = { at: this.now(), value };
      return value;
    }).finally(() => {
      delete entry.flight;
    });
    entry.flight = flight;
    return flight;
  }

  async refresh(): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    if (this.pendingUpdateCheck?.machineId === machineId) return;
    const requestSequence = ++this.requestSequence;
    try {
      const piWebStatus = await this.read(machineId);
      if (this.isCurrent(machineId, requestSequence)) this.setState({ piWebStatus });
    } catch (error) {
      if (!this.isCurrent(machineId, requestSequence)) return;
      this.setState({ piWebStatus: undefined });
      this.onRefreshError(machineId, error);
    }
  }

  checkForUpdates(): Promise<void> {
    const machineId = selectedMachineId(this.getState());
    const existing = this.pendingUpdateCheck;
    if (existing?.machineId === machineId) return existing.promise;

    const requestSequence = ++this.requestSequence;
    const promise = this.api.checkForUpdates(machineId)
      .then((piWebStatus) => {
        this.reads.set(machineId, { answer: { at: this.now(), value: piWebStatus } });
        if (!this.isCurrent(machineId, requestSequence)) return;
        this.setState({ piWebStatus });
        throwForUnsuccessfulReleaseCheck(piWebStatus);
      })
      .catch((error: unknown) => {
        if (this.isCurrent(machineId, requestSequence)) throw error;
      })
      .finally(() => {
        if (this.pendingUpdateCheck?.requestSequence === requestSequence) this.pendingUpdateCheck = undefined;
      });
    this.pendingUpdateCheck = { machineId, requestSequence, promise };
    return promise;
  }

  private isCurrent(machineId: string, requestSequence: number): boolean {
    return selectedMachineId(this.getState()) === machineId && requestSequence === this.requestSequence;
  }
}

function throwForUnsuccessfulReleaseCheck(status: PiWebStatusResponse): void {
  if (status.release.error !== undefined) throw new Error(`PI WEB update check failed: ${status.release.error}`);
  if (status.release.skipped === true) throw new Error("PI WEB update check was skipped because remote version checks are disabled by offline/version-check settings");
}
