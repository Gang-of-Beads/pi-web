/**
 * A list put in the order a reader dragged it into (R11): pins, projects. The whole order is
 * applied, not a move: an id the list no longer holds is dropped, and one added meanwhile on
 * another device keeps its place after the given ones. The machine's store and the page's
 * optimistic copy both apply it, so the two agree on what a drop means.
 */
export function orderedIds(current: readonly string[], order: readonly string[]): string[] {
  const kept = [...new Set(order)].filter((id) => current.includes(id));
  return [...kept, ...current.filter((id) => !kept.includes(id))];
}

export function orderedById<T extends { readonly id: string }>(items: readonly T[], order: readonly string[]): T[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return orderedIds(items.map((item) => item.id), order).flatMap((id) => {
    const item = byId.get(id);
    return item === undefined ? [] : [item];
  });
}
