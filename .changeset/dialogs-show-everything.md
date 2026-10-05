---
"@gang-of-beads/pi-web": patch
---

A question an extension asks (a select, confirm or input) now always shows, as it does in pi's terminal, instead of being refused for its content. A missing title gets a generic heading, a select with no options says so and offers Cancel, repeated and blank options are listed as given, and there is no limit on how many options a select shows. A title or message longer than 32,000 characters is cut, and the cut says how much is missing. Restart the session daemon and reload the page to pick this up.
