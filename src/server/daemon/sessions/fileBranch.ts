/**
 * The branch a session file loads as, by the SDK's own rule
 * (`SessionManager._buildIndex` then `getBranch`): the leaf is the last entry
 * after the header, and the branch is that entry and its parents up to the
 * root, in order.
 *
 * A file holds every branch a reader ever navigated away from. Paging all of
 * its entries showed abandoned answers as if they were the conversation; a
 * read that skips the runtime (P2 slice c, the plugin transcript port) has to
 * resolve the branch the way the runtime would.
 */
export function branchFromFileEntries(entries: readonly unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  let leafId: string | undefined;
  for (const entry of entries) {
    const id = stringField(entry, "id");
    if (id === undefined || stringField(entry, "type") === "session") continue;
    byId.set(id, entry);
    leafId = id;
  }
  const branch: unknown[] = [];
  const seen = new Set<string>();
  let currentId = leafId;
  while (currentId !== undefined && !seen.has(currentId)) {
    seen.add(currentId);
    const current = byId.get(currentId);
    if (current === undefined) break;
    branch.push(current);
    currentId = stringField(current, "parentId");
  }
  return branch.reverse();
}

/**
 * Whether a file can be read as the runtime would load it, with no migration:
 * its header says the current version. The runtime rewrites an older file in
 * place when it opens it, so a read beside that open could see it half
 * written; such a file, or one whose header is missing, has to go through
 * the runtime (P2 slice c).
 */
export function isCurrentVersionFile(entries: readonly unknown[], currentVersion: number): boolean {
  const header = entries.find((entry) => stringField(entry, "type") === "session");
  if (typeof header !== "object" || header === null) return false;
  const version: unknown = Reflect.get(header, "version");
  return typeof version === "number" && version >= currentVersion;
}

function stringField(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const field: unknown = Reflect.get(value, key);
  return typeof field === "string" ? field : undefined;
}
