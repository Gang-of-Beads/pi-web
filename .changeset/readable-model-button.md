---
"@gang-of-beads/pi-web": patch
---

Keep model buttons readable: show full names when they fit, abbreviate the provider only when at least one complete character and an ellipsis fit beside the full model name, otherwise show the model alone and truncate its end only when needed. Older browsers without grapheme segmentation show a provider only when its full name fits.
