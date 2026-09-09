---
"@gang-of-beads/pi-web": patch
---

Round eleven, lane C. The context bar's title had a dead declaration, so the two
stacked chrome rows on a phone started their text 4px apart; the transcript's
"showing messages" line and two settings hints inherited sizes that are not on
the type scale; three picker close controls and a plugin refresh button had no
font at all and fell back to the browser's; the row menu's ellipsis drew a third
larger in one list than the other; and workspace-panel buttons and file-tree
rows sat below the control floor. The message info mark is drawn rather than
typed, so it matches the icons beside it instead of taking whatever font
resolved the character. The box-model guard also reads a floor and a padding
declared for the same selector in two separate rules, which is how the
add-project footer rendered 50px for a 32px token.
