/**
 * Was this scroll event our own follow, or the reader's?
 *
 * `followBottom` writes `scrollTop` and remembers where it aimed, so the scroll
 * event that arrives afterwards is not mistaken for the reader leaving the bottom.
 * The remembered target was kept until matched, which is where it went wrong: a
 * reader who scrolled up was dragged back the moment their position happened to
 * coincide with a target we wrote minutes earlier - the "回弹" the owner reported as
 * happening for no reason. Scrolling up had already said "not the bottom"; the wheel
 * decided, a coincidental equality should not overrule it.
 *
 * A follow scroll lands within a frame or two, so the target is only ours while it
 * is fresh. Anything later is the reader, and the pin stays where their own gesture
 * left it.
 */
export const FOLLOW_SCROLL_GRACE_MS = 250;

export type FollowScrollVerdict = "our-scroll" | "reader-scroll" | "unaimed";

export function followScrollVerdict(input: { target: number | undefined; scrollTop: number; ageMs: number }): FollowScrollVerdict {
  if (input.target === undefined) return "unaimed";
  if (input.ageMs > FOLLOW_SCROLL_GRACE_MS) return "reader-scroll";
  return Math.abs(input.scrollTop - input.target) <= 2 ? "our-scroll" : "reader-scroll";
}
