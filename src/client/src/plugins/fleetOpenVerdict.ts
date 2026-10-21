import type { FleetOpenResult } from "../../../shared/pluginApiTypes";
import type { ScopedSessionTarget, SessionTarget } from "../sessionTarget";

/**
 * What a published target says of a session a plugin asked to open. The resolver opens an `open`
 * or `archived` session instead of publishing it, so either one here means the open did not take.
 */
const TARGET_OPEN_RESULT = {
  open: "superseded",
  archived: "superseded",
  "folder-gone": "folderMissing",
  asking: "machineUnreachable",
  unknown: "machineUnreachable",
  gone: "sessionGone",
  "not-listed": "notListed",
  "not-started-here": "notListed",
  refused: "refused",
} satisfies Record<SessionTarget["kind"], FleetOpenResult>;

export interface FleetOpenSettled {
  /** Whether the open is still the reader's latest navigation. */
  readonly current: boolean;
  readonly machineId: string;
  readonly sessionId: string;
  /** The app's selection once the open settled. */
  readonly selectedMachineId: string;
  readonly selectedSessionId: string | undefined;
  readonly sessionTarget: ScopedSessionTarget | undefined;
}

/**
 * `openSession`'s answer from the app's own verdict once the open settled (the selection and the
 * target the machine-wide locate published), not from the first read: a session its board row
 * placed in the wrong folder is located machine-wide and opened, which is `opened`.
 */
export function fleetOpenVerdict(settled: FleetOpenSettled): FleetOpenResult {
  if (!settled.current || settled.selectedMachineId !== settled.machineId) return "superseded";
  if (settled.selectedSessionId === settled.sessionId) return "opened";
  const target = settled.sessionTarget;
  if (target?.machineId !== settled.machineId || target.sessionId !== settled.sessionId) return "superseded";
  return TARGET_OPEN_RESULT[target.target.kind];
}
