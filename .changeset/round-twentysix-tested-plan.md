---
"@gang-of-beads/pi-web": patch
---

The interrupted-runs retraction is now actually reachable, and the plugin
layer joins the guards and the rail.

Round-25's fix moved a flag write above the emptiness check and left the
banner retraction behind the same early return - the promise shipped, the
behaviour did not. The read's outcome is now one tested plan module: a
failed read announces unknown on a quiet screen, a successful read always
resolves the unknown banner (after the boot read, emptiness is the only
answer a recovery can bring), and on-screen markers are erased only when
the record truly says so. The plugin-backend leg vouches for the machine it
holds instead of asking a URL that cannot answer, the reachability report
accepts an explicit scope, offline and error machine rows wear the danger
rail their dot always had, hoverGuard walks the plugin tree (two live bare
:hover offences in the git panel are wrapped), a machine or workspace switch
no longer replays the previous context's banner for 1.5s, and the coarse
checkbox centring formula names the slot it actually centres in.
