---
"@gang-of-beads/pi-web": patch
---

An extension's own screen reaches the browser, and a dialog that opened before you
connected no longer disappears.

ctx.ui.custom was intercepted and cancelled: pi's headless host resolved the
promise without running the factory, so the pi updater asked for its version
prompt every session and got nothing but a notice saying so. The factory runs
now, the component's lines are shown in a modal, keys are forwarded and redraw
it, and the extension receives the result.

Two state gaps came with it: the client rejected the "custom" kind it was sent,
and a dialog opened before the page connected was not read from the status (the
connection-wide catalog is fetched at boot only), so a reload during an open
dialog showed none.
