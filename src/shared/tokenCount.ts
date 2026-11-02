/** A token count as PI WEB writes it everywhere: the status line and the rows that quote the context. */
export function formatTokenCount(count: number): string {
  if (!Number.isFinite(count)) return "0";
  if (count < 1000) return Math.round(count).toString();
  if (count < 10_000) return `${(count / 1000).toFixed(1)}k`;
  if (count < 1_000_000) return `${String(Math.round(count / 1000))}k`;
  if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  return `${String(Math.round(count / 1_000_000))}M`;
}
