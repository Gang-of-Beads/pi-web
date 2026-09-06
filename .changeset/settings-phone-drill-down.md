---
"pi-web": patch
---

Settings on the phone now drill down instead of swiping through a tab strip

Research into mobile settings patterns (Chrome's stack drill-down guidance,
NN/G on tabs) pointed at the iOS Settings model: the phone opens on a section
list - rows with titles and descriptions, no horizontal strip to swipe - and
picking a row pushes a full-screen page with a "‹ Settings" back control. The
phone's own back gesture walks the same chain because every step lives in the
browser history: `?settings` is the list, `?settings=<section>` a page, and
back from the list closes settings. Desktop keeps the sidebar layout and can
still deep-link straight into a section.
