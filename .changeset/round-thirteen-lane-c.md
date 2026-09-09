---
"@gang-of-beads/pi-web": patch
---

Round thirteen, lane C. The dialog hint fix from the previous commit was a
no-op — the rule already ended in `white-space: nowrap`, which wins — so the
sentence that states a consequence is only now allowed to wrap. Add-machine
fields rendered at 12px in the UI face rather than the 16px monospace they
declare, because a bare `input` selector loses to the host stylesheet appended
after it. Tool cards and delivery receipts draw their marks instead of typing
them, so the double tick is a drawn glyph rather than two characters squeezed
with negative letter-spacing. The composer's trigger hint and collapsed draft
step off `--pi-dim`, the two row overflow menus paint alike, dead status-bar
rules are gone, and the chat gutter's base value reads from the spacing scale.
