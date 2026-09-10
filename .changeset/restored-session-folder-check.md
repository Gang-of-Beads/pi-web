---
"@gang-of-beads/pi-web": patch
---

A remembered session whose folder is gone is deselected at the first
listing, not opened into a red banner.

Boot restore replays the last selection from stored state, and that stored
shape carries no folder stamp - so a session whose working directory was
deleted after the last visit sailed past the row gate and opened into the
full daemon error as a banner. The first workspace listing is where the
app learns the folder is gone; the selection now steps down to that fact
with a notice, and the transcript-failed state stays only for the race
where the folder disappears between listing and click.
