import type { PendingAskUser } from "../../shared/apiTypes";

/**
 * The open forms of the selected session, as the two fields the app state keeps: the oldest, and
 * all of them (state-diagram D2). A selection, a cleared selection and a status write set both
 * from one status. `pendingAsks` used to be written only by a status, so a session's open forms
 * outlived its selection and drew, live, in the next session's chat until that session's status
 * arrived (review b2c94ee9, DeepSeek F4).
 */
export interface OpenAsks {
  readonly pendingAsk: PendingAskUser | undefined;
  readonly pendingAsks: PendingAskUser[];
}

export function openAsksIn(status: { readonly pendingAsk?: PendingAskUser | undefined; readonly pendingAsks?: readonly PendingAskUser[] | undefined } | undefined): OpenAsks {
  const pendingAsks = status?.pendingAsks === undefined ? (status?.pendingAsk === undefined ? [] : [status.pendingAsk]) : [...status.pendingAsks];
  return { pendingAsk: status?.pendingAsk, pendingAsks };
}
