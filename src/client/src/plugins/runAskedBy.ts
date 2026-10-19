import type { SessionRunAskedBy } from "../../../shared/pluginApiTypes";
import type { ChatLine } from "../components/shared";
import { deliveryTaken } from "../messageDelivery";

/**
 * Which device asked for a run that just ended, from the transcript on screen (design voice 4.1 d):
 * the newest user message the agent has taken - not an acceptance echo, not one still on its way or
 * queued - and the device the machine stamped on it (`sentBy`). Unstamped (the terminal, an
 * extension, a machine too old to stamp) is unknown, never another device.
 */
export function runAskedBy(lines: readonly ChatLine[], thisDevice: string | undefined): SessionRunAskedBy {
  const sentBy = newestTakenUserLine(lines)?.meta?.sentBy;
  if (sentBy === undefined || thisDevice === undefined) return "unknown";
  return sentBy === thisDevice ? "this-device" : "another-device";
}

function newestTakenUserLine(lines: readonly ChatLine[]): ChatLine | undefined {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line?.role !== "user" || line.meta?.echo === true) continue;
    const state = line.meta?.delivery?.state;
    if (state === undefined || deliveryTaken(state)) return line;
  }
  return undefined;
}
