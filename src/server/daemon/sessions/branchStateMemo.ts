/**
 * Values read off a session's entries, computed once per state of them.
 *
 * A status names the session's message count, token and cost totals, context usage and when its
 * turn began, and each of those walks the whole branch or every entry (pi's projection for the
 * context usage, which pi's totals compute again). On the owner's 93k-message session that cost
 * about 100 ms a status, and a run publishes a status per runtime event, so the daemon's one
 * loop stayed busy for the whole run and every other request waited behind it (8505 copy of
 * that session, 2026-10-08: an 8.3 s run left 34 ms idle, 7.5 s of it in these walks).
 *
 * They change only when entries do, or with the model whose window the usage is measured
 * against. pi's entries are append-only and every append moves the leaf to a fresh id, so the
 * leaf id names the branch and the entry count names everything appended, on any branch: the
 * key is the session, its leaf, its entry count and the window's model.
 */
export class BranchStateMemo<T> {
  private readonly slots = new WeakMap<object, { readonly key: string; readonly value: T }>();

  read(owner: object, key: string, compute: () => T): T {
    const slot = this.slots.get(owner);
    if (slot?.key === key) return slot.value;
    const value = compute();
    this.slots.set(owner, { key, value });
    return value;
  }
}

interface BranchStateModel {
  readonly provider: string;
  readonly id: string;
  readonly contextWindow?: number;
}

/** The parts of a session a branch state key is read from. */
export interface BranchStateSession {
  readonly sessionId: string;
  readonly sessionManager: { getLeafId(): string | null; getEntries?: () => readonly unknown[] };
  readonly model: BranchStateModel | undefined;
  readonly routedModel?: { readonly model: BranchStateModel } | undefined;
}

/**
 * The state a session's entry-derived values belong to. The model is the one pi measures the
 * context window against: the routed physical model under a virtual selection, else the
 * selected one.
 */
export function branchStateKey(session: BranchStateSession): string {
  const model = session.routedModel?.model ?? session.model;
  const entryCount = session.sessionManager.getEntries?.().length ?? "";
  return [session.sessionId, session.sessionManager.getLeafId() ?? "", entryCount, model?.provider ?? "", model?.id ?? "", model?.contextWindow ?? ""].join("\u0000");
}
