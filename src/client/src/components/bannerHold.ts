export const BANNER_MIN_VISIBLE_MS = 1500;

export type BannerHoldDecision =
  | { kind: "show"; text: string }
  | { kind: "hide" }
  | { kind: "hold"; retryInMs: number };

export function bannerHoldDecision(state: {
  shownAt: number | undefined;
  now: number;
  next: string;
}): BannerHoldDecision {
  if (state.next !== "") return { kind: "show", text: state.next };
  if (state.shownAt === undefined) return { kind: "hide" };
  const elapsed = state.now - state.shownAt;
  if (elapsed >= BANNER_MIN_VISIBLE_MS) return { kind: "hide" };
  return { kind: "hold", retryInMs: BANNER_MIN_VISIBLE_MS - elapsed };
}
