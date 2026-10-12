export const BANNER_MIN_VISIBLE_MS = 1500;

/**
 * How long a transport claim must stand, with the page in view, before it earns the banner: long
 * enough that one failed poll mid-restart never flashes (the owner's "flashing up all the time
 * means nothing") and that the reads a return to the page sends can answer, short enough that a
 * real outage is named. Recovery inside the window shows nothing at all. 10 s by the owner's word
 * (2026-10-12). Time the page spends hidden does not count (`graceLeftMs`).
 */
export const TRANSIENT_GRACE_MS = 10_000;

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
