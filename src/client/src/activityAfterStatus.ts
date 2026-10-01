import type { SessionActivity, SessionStatus } from "./api";
import { isSessionActive } from "../../shared/activity";

/**
 * The activities that outlived their sessions' statuses (state-diagram D3).
 *
 * An activity says "working" until a later fact says otherwise. A status that is not active is such
 * a fact, from a frame or from a read of the machine's catalog; so is a catalog that no longer
 * lists the session at all, when the caller replaces what it knew (`retractsMissing`). A missing
 * status otherwise means unknown and keeps the activity. Before the catalog took this rule, a lost
 * `activity.update` left a session reading WORKING for good though its status said idle, and
 * nothing would ever publish the idle activity again (review of 2dcf8caa).
 */
export function activitiesAfterStatuses(
  activities: Readonly<Record<string, SessionActivity>>,
  statuses: Readonly<Record<string, SessionStatus | undefined>>,
  options: { readonly retractsMissing: boolean },
): Record<string, SessionActivity> {
  const kept = Object.entries(activities).filter(([sessionId, activity]) => {
    if (activity.phase !== "active") return true;
    const status = statuses[sessionId];
    if (status === undefined) return !options.retractsMissing;
    return isSessionActive(status);
  });
  return kept.length === Object.keys(activities).length ? { ...activities } : Object.fromEntries(kept);
}
