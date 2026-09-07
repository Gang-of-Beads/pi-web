---
"@earendil-works/pi-web": patch
---

Touch density lands the two-token policy: 24px stays the AA floor everywhere and
coarse pointers now get the 44px comfort floor across the surfaces that were
still shipping mouse-sized targets on touch - the session list toolbar and
search row, the quick switcher (close, tabs, chips, row menus), the composer's
icon buttons, model picker and thinking gauge, the context switcher add button
and phone header actions, the shared list search row, section add buttons, and
extension dialog actions. Message timestamps collapse to 24px (AA met, inline
exception recorded) and the tile menu keeps its documented 36px exemption. A
new fail-loud probe (`scripts/probe-touch-targets.mjs`) walks every shadow root
at 393x850 coarse and asserts the floors with the recorded exemptions.
