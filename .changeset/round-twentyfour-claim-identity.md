---
"@gang-of-beads/pi-web": patch
---

The expiry schedule is a claim, and the boot read happens once.

Two machines down in a row produce identical banner text; the expiry timer
that was armed for the first machine's claim deleted the second machine's
banner that never answered once, because both the re-arm gate and the
timer's own guard compared wording only. The schedule now carries the
machine it was armed for. A machine switch re-enters the boot read path,
which re-read the already-spent interrupted-runs record with boot semantics
and erased markers the reader was on their way to act on; the boot read is
now once per page. The expiry timer resets the schedule marker it fires on,
the settings nav button and two touch floors draw at their declared
geometry, the dead deadline branch and the dead ReportedError helper are
gone, and the unknown banner promises only what a reconnect can deliver.
