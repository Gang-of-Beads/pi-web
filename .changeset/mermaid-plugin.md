---
"@gang-of-beads/pi-web": patch
---

Mermaid fences render as diagrams.

A bundled Mermaid plugin claims ```mermaid fences through the code-fence
renderer seam: the diagram engine is vendored with the plugin and loaded on
the first diagram, never at boot; each fence is parsed before it is drawn
in strict mode, matches the page theme, and a fence that does not parse
stays a plain code block. The source stays available to the copy button
under a drawn diagram.
