---
"@gang-of-beads/pi-web": patch
---

Plugins can claim a fenced code language in the transcript.

A new `codeFenceRenderers` contribution names a language (for example
`mermaid`) and returns a DOM node for a settled code block's source; the
transcript draws it above the block and keeps the source underneath for
copy. One claimant per language per machine; a renderer that throws or
rejects leaves the plain code block standing. Markdown parsing and
sanitizing are unchanged - the drawing is added after the safe parse, never
through it.
