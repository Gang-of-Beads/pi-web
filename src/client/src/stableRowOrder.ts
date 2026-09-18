/**
 * Row order that does not move under a thumb.
 *
 * The navigation page refreshes from live events, which is what keeps session
 * state honest - but recency order means an arriving event can lift a row past
 * the one the reader was aiming at, and the tap lands on the wrong session.
 * While the page is open the order it opened with is kept: rows that are still
 * present hold their places, rows that arrive are appended, and rows that
 * vanish are dropped. Content inside each row still updates live; only the
 * sequence is frozen. Closing the page releases the freeze, so the next open
 * is ordered by recency again.
 */

export interface StableRowOrder<T> {
  order: (rows: readonly T[]) => T[];
  /** Forget the frozen sequence, e.g. when the surface closes or the scope changes. */
  release: () => void;
}

export function createStableRowOrder<T>(keyOf: (row: T) => string): StableRowOrder<T> {
  let frozen: string[] | undefined;
  return {
    order(rows) {
      const byKey = new Map(rows.map((row) => [keyOf(row), row]));
      if (frozen === undefined) {
        frozen = [...byKey.keys()];
        return [...rows];
      }
      const held = frozen.filter((key) => byKey.has(key));
      const arrived = [...byKey.keys()].filter((key) => !held.includes(key));
      frozen = [...held, ...arrived];
      return frozen.map((key) => byKey.get(key)).filter((row): row is T => row !== undefined);
    },
    release() {
      frozen = undefined;
    },
  };
}
