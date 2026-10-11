---
"@gang-of-beads/pi-web": patch
---

A screen an extension draws for pi's terminal (`ctx.ui.custom` with nothing declared for PI WEB, such as pi-prompt-history's picker) no longer looks like a terminal in the conversation. Its text is drawn in the app's font, with the extension's own emphasis (its accent, dim and selected rows) in the app's colours. The box drawing and key-hint row are left out, and the card is headed by the extension's name instead of "Extension screen". Tapping a line now selects the item you tapped, including an item drawn on two lines and the last item of a list; a tap on no item selects nothing. Cancel first sends the screen Esc, as pi's terminal would, so an extension that closes its screen on Esc no longer asks the same question again through its fallback dialogs. Restart the session daemon to apply.
