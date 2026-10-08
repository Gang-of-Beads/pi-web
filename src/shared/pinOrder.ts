/**
 * A pinned list put in the order a reader dragged it into (R11). The whole order is applied, not a
 * move: an id no longer pinned is dropped, and one pinned meanwhile on another device keeps its
 * place after the given ones. The machine's pin store and the page's optimistic copy both apply it,
 * so the two agree on what a drop means.
 */
export function orderedPins(current: readonly string[], order: readonly string[]): string[] {
  const kept = [...new Set(order)].filter((id) => current.includes(id));
  return [...kept, ...current.filter((id) => !kept.includes(id))];
}
