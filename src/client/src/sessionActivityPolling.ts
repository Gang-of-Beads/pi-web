/**
 * When the open session should keep re-reading its activity (subagents,
 * subagent-tool runs and background tasks).
 *
 * The list used to be fetched only when a session was selected, but the normal
 * way to acquire a subagent is to ask for one in the session you are already
 * reading: nothing refetched afterwards, so the drawer stayed empty until the
 * reader switched sessions and came back. Polling is therefore tied to having
 * a session on screen, and stops with the tab so a backgrounded browser is not
 * charged for a conversation nobody is watching.
 */
export function shouldPollSessionActivity(input: { hasSelectedSession: boolean; documentVisible: boolean }): boolean {
  return input.hasSelectedSession && input.documentVisible;
}

/**
 * One read at a time, with the last request honoured.
 *
 * A timer that fires every four seconds does not wait for the read it started
 * last time. When a read takes longer than the interval - a slow link, a
 * machine across the network, a session with a hundred runs to describe - the
 * requests stack, each one making the next slower, and the list a reader is
 * watching falls further behind the disk the longer they watch it.
 *
 * Dropping the overlapping call outright would be wrong in the one case that
 * matters most: selecting a session asks for a read immediately, and that read
 * is about a different session than the one in flight. So a call that arrives
 * during a read is remembered and runs once the read finishes, and any number
 * of calls in that window collapse into that single re-read.
 */
export function oneReadAtATime(read: () => Promise<void>): () => Promise<void> {
  let reading = false;
  let requested = 0;
  async function drain(): Promise<void> {
    reading = true;
    try {
      let served = -1;
      while (served !== requested) {
        served = requested;
        await read();
      }
    } finally {
      reading = false;
    }
  }
  return async () => {
    requested += 1;
    if (reading) return;
    await drain();
  };
}
