---
"@gang-of-beads/pi-web": patch
---

The drawn marks actually draw. Since round twelve the icons composed their
shapes through a nested template, which puts them in the XHTML namespace where
an `<svg>` paints nothing: the send and read receipts under user messages, the
copy, resend and recall controls, the tool status marks and the status-bar
arrows have been blank boxes, while every geometric check agreed they were 14px
and centred. Each icon is inlined in one template now, a unit test fails if a
shape leaves the SVG namespace, and a probe fails if any rendered shape does.
The close mark is one language too: thirty-two typed × characters across ten
dialogs, the pickers, the sheets and six plugin surfaces now draw the same mark,
with contributed surfaces borrowing it through the plugin host.
