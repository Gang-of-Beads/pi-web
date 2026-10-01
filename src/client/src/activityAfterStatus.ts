import type { SessionActivity, SessionStatus } from "./api";
import { isSessionActive } from "../../shared/activity";

/** Whether an activity outlived a status: it says "active" while the status says the session is not. */
export function activityOutlivesStatus(activity: SessionActivity | undefined, status: SessionStatus): boolean {
  return activity?.phase === "active" && !isSessionActive(status);
}

/**
 * The activities left after a read of the machine's statuses (state-diagram D3).
 *
 * An activity says "working" until a later fact says otherwise. A status that is not active is such
 * a fact; so is a catalog that no longer lists the session, when the caller replaces what it knew
 * (`retractsMissing`). A missing status otherwise means unknown and keeps the activity. Before the
 * read took this rule, a lost `activity.update` left a session reading WORKING for good though its
 * status said idle (review of 2dcf8caa). `keeps` names the activities the read cannot speak for: one
 * applied from a frame while the read was on its way, or a session this page is still starting.
 */
export function activitiesAfterStatuses(
  activities: Readonly<Record<string, SessionActivity>>,
  statuses: Readonly<Record<string, SessionStatus | undefined>>,
  options: { readonly retractsMissing: boolean; readonly keeps?: (sessionId: string) => boolean },
): Record<string, SessionActivity> {
  return Object.fromEntries(Object.entries(activities).filter(([sessionId, activity]) => {
    if (activity.phase !== "active" || options.keeps?.(sessionId) === true) return true;
    const status = statuses[sessionId];
    return status === undefined ? !options.retractsMissing : !activityOutlivesStatus(activity, status);
  }));
}
