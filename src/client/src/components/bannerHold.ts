export const BANNER_MIN_VISIBLE_MS = 1500;

/**
 * How long a transport claim must stand before it earns the banner: long
 * enough that one failed poll mid-restart never flashes (the owner's
 * "经常闪一下也没意义"), short enough that a real outage is named quickly.
 * Recovery inside the window shows nothing at all.
 */
export const TRANSIENT_GRACE_MS = 4000;

export type BannerHoldDecision =
  | { kind: "show" }
  | { kind: "hide" }
  | { kind: "hold"; retryInMs: number };

export function bannerHoldDecision(state: {
  shownAt: number | undefined;
  now: number;
  next: string;
}): BannerHoldDecision {
  if (state.next !== "") return { kind: "show" };
  if (state.shownAt === undefined) return { kind: "hide" };
  const elapsed = state.now - state.shownAt;
  if (elapsed >= BANNER_MIN_VISIBLE_MS) return { kind: "hide" };
  return { kind: "hold", retryInMs: BANNER_MIN_VISIBLE_MS - elapsed };
}
