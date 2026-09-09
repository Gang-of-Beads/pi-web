---
"@gang-of-beads/pi-web": patch
---

The chat surface stops blinking while a turn runs. Row activity marks and the
working chip were created and destroyed whenever their state changed — a
different template shape per state, and nothing at all when idle — so every
list row's dot and the header chip were rebuilt repeatedly while an answer
streamed. Measured on a real turn at 393x850: seventeen node removals in twenty
seconds before, six after, with the row marks and the working chip down to
zero. Each mark is one element that stays mounted and changes state, which is
also why a hidden mark is now the honest way to say "nothing to show".
