---
"@gang-of-beads/pi-web": patch
---

Follow-ups from the round-15 verification lane. The load-failure banner now
really retires itself when a retry succeeds: the first version of that fix put
the retirement behind a branch that could never run, because a settled load
and an absent entry were indistinguishable at the call site - the verification
lane caught the dead branch behind a published claim. Also: the fold button's
padding override now wins instead of sitting dead in front of the rule it was
meant to beat, the module docstring says what the open path actually does,
and the companion [hidden] rules are pinned by tests so the attribute-only
blind spot cannot come back quietly.
