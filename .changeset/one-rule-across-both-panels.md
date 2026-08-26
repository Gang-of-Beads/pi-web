---
"@vincenthanxiaodu/pi-web": patch
---

Align the navigation and chat headers on one height

The two headers sit either side of the main divider, so their bottom borders
read as one horizontal rule - except they were 56px and 36px. The rail was
taller because its buttons were never given a size and inherited the user
agent's 31px. Both headers and the rail's controls now size from shared
panel-header tokens, so the rule lines up and stays lined up.
