---
"@vincenthanxiaodu/pi-web": patch
---

The goals panel no longer shows another project's goal. Keeping the previous list across a loading or failed read fixed the vanishing Goals chip, but the retention answered to nothing: after the switcher moved the selection to another project, the panel kept rendering the previous project's goal with live Resume and Abandon buttons, so acting on it would archive another project's goal from the wrong session. The retained list is now keyed to the machine+project+workspace it was fetched for - rendered only while that key matches the selection, with the action controls withheld otherwise - which keeps the chip through loading and failures for the same workspace while making the cross-workspace bleed impossible. A session switch that moves workspaces now also refreshes the goals and re-seeds the session list from the keyed cache instead of carrying the previous workspace's rows.
