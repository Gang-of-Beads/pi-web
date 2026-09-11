---
"@gang-of-beads/pi-web": patch
---

The "Pro (native)" theme card actually selects the native look.

The appearance panel's click handler routed every card through the plugin
theme registry - but the native pro look is a sentinel, not a plugin
theme, so the lookup silently returned and the card did nothing. The
sentinel is now handled before the registry lookup: picking the card
switches to the core's own look (and persists), like every other card.
