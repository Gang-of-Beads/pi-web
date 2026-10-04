/**
 * Row order that moves live, except under a finger.
 *
 * Lists re-sort as sessions change state (owner, 2026-10-04: sessions order by what they need from
 * the reader, live). A row that moves while the reader is pressing, or in the moment after a tap,
 * makes the tap land on the wrong session, so while a pointer is down on the list and for
 * `TAP_SETTLE_MS` after it lifts, the last order holds: rows still present keep their places, rows
 * that arrive are appended, rows that leave are dropped. Content inside each row still updates.
 * When the hold ends, the next render takes the live order.
 *
 * This replaces the freeze-for-the-whole-visit order the Navigate page had, which kept a session
 * that started asking for an answer wherever it happened to be when the page opened.
 */
export const TAP_SETTLE_MS = 600;

export interface HeldRowOrder<T> {
  order: (rows: readonly T[], now: number) => T[];
  /** A pointer went down on the list. */
  hold: () => void;
  /** The pointer lifted or was cancelled; returns how long, in ms, the order still holds. */
  letGo: (now: number) => number;
  /** Forget the held order, e.g. when the list closes or its scope changes. */
  release: () => void;
}

export function createHeldRowOrder<T>(keyOf: (row: T) => string): HeldRowOrder<T> {
  let last: string[] | undefined;
  let pressed = false;
  let heldUntil = 0;
  return {
    order(rows, now) {
      const live = rows.map(keyOf);
      if (last === undefined || (!pressed && now >= heldUntil)) {
        last = live;
        return [...rows];
      }
      const byKey = new Map(rows.map((row) => [keyOf(row), row]));
      const kept = last.filter((key) => byKey.has(key));
      const arrived = live.filter((key) => !kept.includes(key));
      last = [...kept, ...arrived];
      return last.map((key) => byKey.get(key)).filter((row): row is T => row !== undefined);
    },
    hold() {
      pressed = true;
    },
    letGo(now) {
      pressed = false;
      heldUntil = now + TAP_SETTLE_MS;
      return TAP_SETTLE_MS;
    },
    release() {
      last = undefined;
      pressed = false;
      heldUntil = 0;
    },
  };
}
