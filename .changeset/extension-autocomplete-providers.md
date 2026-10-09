---
"@gang-of-beads/pi-web": patch
---

Pi extensions' autocomplete providers (`ctx.ui.addAutocompleteProvider`) now complete in the PI WEB composer: where pi's editor would ask them (a `/` opening a line, or `@`, `#` or the provider's own trigger characters opening a word), their suggestions show in the composer's list, ahead of PI WEB's own, and picking one inserts it the way the extension does in pi's terminal. Restart the session daemon and reload the page.
