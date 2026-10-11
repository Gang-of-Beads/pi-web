---
"@gang-of-beads/pi-web": patch
---

A question an extension declares for the Questions card can now show its typed answer as a box under the options, ready to type into, instead of a Custom choice that opens the box: the extension adds `customInput: "field"` to the question. On a single-answer question, typing replaces the chosen option and choosing an option empties the box. Restart the session daemon to pick this up.
