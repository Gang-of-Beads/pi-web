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
 *
 * A status also brings the session's latest activity, and a session the page knows none for takes
 * it, as a live status does (`statusActivityToAdopt`). Without that a page loaded after a session
 * failed never learned the failure: every session but the selected one read idle in the switcher and
 * on the Go to page, while a page open at the time said error (B14, probe-one-classifier.mjs).
 * `adopts` names the sessions the read may teach; the selected session learns from its own status
 * read, which also sets the dock's activity.
 */
export function activitiesAfterStatuses(
  activities: Readonly<Record<string, SessionActivity>>,
  statuses: Readonly<Record<string, SessionStatus | undefined>>,
  options: { readonly retractsMissing: boolean; readonly keeps?: (sessionId: string) => boolean; readonly adopts?: (sessionId: string) => boolean },
): Record<string, SessionActivity> {
  const kept: Record<string, SessionActivity> = Object.fromEntries(Object.entries(activities).filter(([sessionId, activity]) => {
    if (activity.phase !== "active" || options.keeps?.(sessionId) === true) return true;
    const status = statuses[sessionId];
    return status === undefined ? !options.retractsMissing : !activityOutlivesStatus(activity, status);
  }));
  for (const [sessionId, status] of Object.entries(statuses)) {
    const adopted = status === undefined || options.adopts?.(sessionId) !== true ? undefined : statusActivityToAdopt(kept[sessionId], status);
    if (adopted !== undefined) kept[sessionId] = adopted;
  }
  return kept;
}

/**
 * The activity a status brings, taken only when the page knows none for the
 * session: a page that opens in the middle of a long step learns it here,
 * before the next frame (B25). A live frame already seen is newer and stays.
 */
export function statusActivityToAdopt(known: SessionActivity | undefined, status: SessionStatus): SessionActivity | undefined {
  if (known !== undefined || status.activity === undefined) return undefined;
  return activityOutlivesStatus(status.activity, status) ? undefined : status.activity;
}
