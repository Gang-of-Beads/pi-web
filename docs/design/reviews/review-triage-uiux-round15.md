# Round 15 triage: the convergence check that found its own wave guilty

Configuration: two glm lanes with split focus (geometry/contracts, behavior/
data) plus one qwen full pass - all bllm, per the owner's ruling that the
lanes are bllm now. Liveness probe confirmed both models answer before the
round launched.

## Findings and dispositions

Lane A (geometry/contracts): 6 findings, all adjudicated TRUE by the lane.
- F1 idle session wears working dots forever (author display beats [hidden]).
  **Fixed** - companion rules, plus structural tests.
- F2 idle rows carry an unread-class marker the rail's :has() still sees.
  **Fixed** - idle class no longer "unread"; wrapper restates hidden.
- F3 fold button's dead padding override. **Fixed** - real box + a
  higher-specificity override that wins.
- F4 tile path line assumed a line height it did not pin. **Fixed.**
- F5 collapsed composer used a private 10px inset. **Fixed** - aligned to the
  conversation column.
- F6 fold state survives section/view switches. **Judged not-true as a
  defect** (lane B's adjudication stands: the folded row holds global actions,
  unrelated to the section switched); recorded as an owner-visible behavior.

Lane B (behavior/data): 4 findings, all TRUE.
- B1 session-tree load in the render path - unbounded microtask loop, page
  freeze. **Fixed** - load fires on the dialog's first appearance, outside
  render. (Lane C verified the loop is gone but corrected the prose: it is the
  move out of render that kills the loop, not "a settled load scheduling
  nothing".)
- B2 prefetch wrote under the machine selected at merge time, not the one
  asked. **Fixed.**
- B3 failure banner survived a successful retry. **Fixed twice** - the first
  fix's retirement branch was dead code (loadSurface never returns undefined);
  lane C caught it and the retirement now lives in the success path of the
  fresh load.
- B4 failed prefetch remembered forever. **Fixed** - forgotten, matching the
  lazy-surface rule.

Lane C (qwen full pass, re-run after the fixes): verified all nine fixes hold
against HEAD, and reported seven follow-ups: the dead retirement branch (fixed
as B3 above), the misattributed prose (this page is the correction), the
attribute-only test blind spot (structural rule tests added), stale docstring
claims about awaiting (corrected), the leftover dead declaration (removed), no
prefetch test coverage (accepted gap: the logic sits inside the controller
harness; the machine-key rule is one line and reviewed), and a double space
(fixed).

## Verdict

Round 15 was not a clean round - it found nine real defects in the
architecture wave, two of which were the screen lying to the reader. The
follow-up round (16) runs the same three-lane configuration against the fixed
HEAD; convergence requires a round where all three lanes report zero findings.
