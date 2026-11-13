import { isRecord } from "./sessionFileFormat.js";

export type SessionEntryActivity =
  | { readonly kind: "activity"; readonly timestamp: string }
  | { readonly kind: "cache-warm" | "unknown" };

/** Cache-warming usage remains billable without making an untouched conversation recent. */
export function sessionEntryActivity(entry: unknown): SessionEntryActivity {
  if (!isRecord(entry)) return { kind: "unknown" };
  if (entry["type"] === "usage" && entry["kind"] === "cache_warm") return { kind: "cache-warm" };
  const timestamp = entry["timestamp"];
  return typeof timestamp === "string" && Number.isFinite(Date.parse(timestamp))
    ? { kind: "activity", timestamp }
    : { kind: "unknown" };
}

/** Walk only a warming tail, leaving branch choice and unknown ancestry with the session manager. */
export function lastSessionActivityAt(leaf: unknown, entryById: (id: string) => unknown): string | undefined {
  const seen = new Set<string>();
  let current = leaf;
  while (isRecord(current)) {
    const activity = sessionEntryActivity(current);
    if (activity.kind !== "cache-warm") return activity.kind === "activity" ? activity.timestamp : undefined;
    const parentId = current["parentId"];
    if (typeof parentId !== "string" || seen.has(parentId)) return undefined;
    seen.add(parentId);
    current = entryById(parentId);
  }
  return undefined;
}

type TreeLeafState = "same" | "warming-only" | "changed" | "unknown";

const TREE_LEAF_CURRENT: Readonly<Record<TreeLeafState, boolean>> = { same: true, "warming-only": true, changed: false, unknown: false };

/** Only bookkeeping descendants may preserve a captured tree revision; real or unknown changes never do. */
export function sessionTreeLeafMatches(currentLeafId: string | null, expectedLeafId: string | null, entryById: (id: string) => unknown): boolean {
  return TREE_LEAF_CURRENT[treeLeafState(currentLeafId, expectedLeafId, entryById)];
}

function treeLeafState(currentLeafId: string | null, expectedLeafId: string | null, entryById: (id: string) => unknown): TreeLeafState {
  if (currentLeafId === expectedLeafId) return "same";
  const seen = new Set<string>();
  let cursor = currentLeafId;
  while (cursor !== expectedLeafId) {
    if (cursor === null) return "changed";
    if (seen.has(cursor)) return "unknown";
    seen.add(cursor);
    const entry = entryById(cursor);
    if (!isRecord(entry)) return "unknown";
    if (sessionEntryActivity(entry).kind !== "cache-warm") return "changed";
    const parentId = entry["parentId"];
    if (parentId !== null && typeof parentId !== "string") return "unknown";
    cursor = parentId;
  }
  return "warming-only";
}
