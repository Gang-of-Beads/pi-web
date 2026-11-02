export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost === 0) return "$0";
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}
