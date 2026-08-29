---
"@vincenthanxiaodu/pi-web": patch
---

Hold the transcript and the notification drawer still under a finger when an ask or dialog opens, and never let live content move the control being aimed at.

Opening an ask-user form or an extension dialog aligns the card to the top of the transcript, which pulls every line above it upward. Measured at 393x850 with a pointer held on the transcript: a dialog opening mid-press moved the block under the finger 330px, an ask 236px (at 1440x900: 282px and 241px). Both alignments now go through the same ScrollFollowGate the live-tail follow uses: refused while a pointer is down, replayed once the press ends and the settle grace has let the tap land, and dropped when the reader scrolled away or the card was answered before the release. A press that opens nothing still catches up to the bottom.

The notifications drawer turned out to have no gate at all: it is its own scroller, and a notification arriving mid-press prepends a row above every settled card. Measured at 393x850: the settled card under a resting finger moved 60px (the same at 1440x900) and stayed moved - the owner's two-tap Dismiss. The drawer now holds live tray updates while a pointer rests on it and applies them once the press ends, through a second instance of the same gate, so there is one owner for "may this surface follow live content" and no third hand-rolled variant. A tray that was not on screen when the press started (a first tray, or another chat's after a switch) shows live, because there is nothing under the finger to keep still.
