/**
 * The app row's two sentences for a link that does not answer (owner, 2026-10-12: the same outage
 * read "Trying to sync with the server…" one moment and "Trying to sync with build-box…" the
 * next). The page cannot reach the machine that serves it: "Trying to reach" that machine. The page
 * reaches it and the machine on screen does not answer: "Trying to sync with" that machine. A
 * machine is always named; nothing says "the server". Every producer of either sentence words it
 * here, so the row has one phrasing per state.
 */
export function reachWords(pageMachine: string): string {
  return `Trying to reach ${pageMachine}…`;
}

export function syncWords(machine: string): string {
  return `Trying to sync with ${machine}…`;
}

/** The page knows it is behind this machine and is fetching what it missed. */
export function syncingWords(machine: string): string {
  return `Syncing with ${machine}…`;
}

/** The machines a row sentence can name: the one serving this page, and the one a claim is about. */
export interface RowNames {
  readonly page: string;
  readonly machine: string;
}
