---
"@vincenthanxiaodu/pi-web": patch
---

The Add-project folder list now belongs to the text currently in the input. Rows for a query the reader already left disappear the moment the path changes; every keystroke aborts the previous server-side directory walk (the walk also gained a 2-second wall-clock budget beside its 4,000-directory count budget, and the server stops scanning when the requesting connection closes); and a failed search reads as "Search failed - try again" instead of the misleading "No matching folders found". The trust read is debounced like the search instead of firing on every keystroke.
