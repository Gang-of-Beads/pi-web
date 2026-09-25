---
"@gang-of-beads/pi-web": patch
---

The idle app stops re-rendering and re-asking for pins.

Reading the machine pins happened while rendering, and every read ended in a
render that read again: 1,425 requests a second to the pins endpoint and just
as many full re-renders, which is what made the interface feel busy and kept
moving the transcript under the reader. A machine that has answered is now
re-read only once its answer is stale.
