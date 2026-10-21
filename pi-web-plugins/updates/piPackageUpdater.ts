import { packagePair, type PiPackageUpdateFact } from "./updatesOffer.js";

/**
 * Pi package updates run from the Updates page and the pop-up, one machine each.
 *
 * An update goes through the machine-scoped core route the Settings page uses, inline: the page
 * survives a package update, so no terminal is needed. "Update all" runs one source at a time, so
 * each row reports its own outcome and nothing but the rows asked for is touched. Outcomes are kept
 * per `source@version`: a newer version on the next check is a new row, not this one's result.
 */
export type PackageUpdateOutcome =
  | { readonly kind: "updating" }
  | { readonly kind: "updated"; readonly from: string | undefined; readonly to: string | undefined }
  | { readonly kind: "failed"; readonly error: string };

export interface PiPackageUpdater {
  outcome(update: PiPackageUpdateFact): PackageUpdateOutcome | undefined;
  readonly busy: () => boolean;
  update(update: PiPackageUpdateFact): Promise<void>;
  updateAll(updates: readonly PiPackageUpdateFact[]): Promise<void>;
  /** Called on every outcome change; the returned function unsubscribes. */
  onChange(listener: () => void): () => void;
}

export interface PiPackageUpdaterPorts {
  readonly machineId: string;
  readonly fetchJson: (path: string, init?: { method?: string; body?: unknown }) => Promise<unknown>;
  readonly describeError: (error: unknown) => string;
}

function piPackageUpdatePath(machineId: string): string {
  return `api/machines/${encodeURIComponent(machineId)}/pi-packages/update`;
}

export function createPiPackageUpdater(ports: PiPackageUpdaterPorts): PiPackageUpdater {
  const outcomes = new Map<string, PackageUpdateOutcome>();
  const listeners = new Set<() => void>();
  const set = (update: PiPackageUpdateFact, outcome: PackageUpdateOutcome): void => {
    outcomes.set(packagePair(update), outcome);
    for (const listener of listeners) listener();
  };
  const update = async (target: PiPackageUpdateFact): Promise<void> => {
    if (outcomes.get(packagePair(target))?.kind === "updating") return;
    set(target, { kind: "updating" });
    try {
      await ports.fetchJson(piPackageUpdatePath(ports.machineId), { method: "POST", body: { source: target.source } });
      set(target, { kind: "updated", from: target.installed, to: target.available });
    } catch (error) {
      set(target, { kind: "failed", error: ports.describeError(error) });
    }
  };
  return {
    outcome: (target) => outcomes.get(packagePair(target)),
    busy: () => [...outcomes.values()].some((outcome) => outcome.kind === "updating"),
    update,
    updateAll: async (targets) => {
      for (const target of targets) await update(target);
    },
    onChange: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
