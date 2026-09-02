/** What quick access can show for the machine the reader is pointed at. */
export type QuickSwitcherScope =
  | { state: "ready"; machineId: string }
  | { state: "loading"; machineId: string }
  | { state: "other-machine"; machineId: string; cachedFor: string };

/**
 * Which machine's sessions quick access may draw right now.
 *
 * The list is fetched per machine, so it has to travel with the machine it was
 * fetched for. Switching the tab before the new read lands leaves the previous
 * machine's sessions in hand, and drawing those under the new tab's name offers
 * the reader sessions that are not there - the same fault as a goal panel
 * rendering another project's goal with a live Abandon button on it.
 *
 * So a cache belonging to a different machine is its own state, and the caller
 * must render it as "still loading this machine" rather than as a list. Empty
 * is not a substitute either: an empty list would read as "this machine has no
 * sessions", which is a claim nobody has checked yet.
 */
export function quickSwitcherScope(input: {
  tabMachineId: string;
  cachedMachineId: string | undefined;
  loading: boolean;
}): QuickSwitcherScope {
  if (input.cachedMachineId !== undefined && input.cachedMachineId !== input.tabMachineId) {
    return { state: "other-machine", machineId: input.tabMachineId, cachedFor: input.cachedMachineId };
  }
  if (input.loading || input.cachedMachineId === undefined) return { state: "loading", machineId: input.tabMachineId };
  return { state: "ready", machineId: input.tabMachineId };
}
