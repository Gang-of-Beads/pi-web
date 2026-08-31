/**
 * Which of a session's current warnings still need filing in its notification
 * drawer.
 *
 * Warnings used to render as cards above the transcript; on a phone five of
 * them filled the screen and moved the layout as they came and went. The
 * drawer already owns information that arrives on its own, so warnings become
 * notifications - but status assembly runs on every poll and publish, and
 * filing on each pass would deposit the same warning forever. The memo
 * remembers what this daemon process already filed, per session.
 *
 * No persistence on purpose: after a restart a still-present warning files
 * once more, which is honest - the condition was re-observed by a new process.
 * A warning that clears and later recurs files again for the same reason.
 */

import type { SessionWarning } from "../../../shared/apiTypes";

/**
 * Bound against a pathological diagnostics flood. Eviction can in principle
 * re-file an old identity, which is the correct failure direction: a duplicate
 * record, never a lost warning.
 */
const FILED_WARNING_MEMO_CAP = 128;

/** Content identity, computed before any display truncation. */
export function warningIdentity(warning: SessionWarning): string {
  return `${warning.severity}|${warning.source ?? ""}|${warning.path ?? ""}|${warning.message}`;
}

/**
 * Returns the warnings not yet filed, and records them in the memo. The caller
 * must only invoke this when it is actually able to file - a skipped filing
 * must never be memoized as a delivered one.
 */
export function takeUnfiledWarnings(memo: Set<string>, warnings: readonly SessionWarning[]): SessionWarning[] {
  const unfiled: SessionWarning[] = [];
  for (const warning of warnings) {
    const identity = warningIdentity(warning);
    if (memo.has(identity)) continue;
    memo.add(identity);
    unfiled.push(warning);
  }
  while (memo.size > FILED_WARNING_MEMO_CAP) {
    const oldest = memo.values().next().value;
    if (oldest === undefined) break;
    memo.delete(oldest);
  }
  return unfiled;
}
