---
"@gang-of-beads/pi-web": patch
---

The composer stays put while you answer a question.

It used to shrink to a strip whenever a question form or dialog field took
focus, which moved a control under the thumb and cost a tap to get the editor
back. The collapse is removed rather than disabled: the state, its listeners
and its module are gone.
