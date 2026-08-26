---
"@vincenthanxiaodu/pi-web": patch
---

Support Azure Speech for live transcription

Azure's socket speaks a third vocabulary: a hypothesis while a phrase is still
forming, and a recognised phrase once it settles. Its hypotheses re-send the
whole phrase, so they replace the current guess rather than extending it. A
turn that recognised nothing is ignored rather than treated as an empty final,
which would have wiped what had already been dictated.
