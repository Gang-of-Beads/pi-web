---
"@gang-of-beads/pi-web": patch
---

Pi extensions' own message and entry renderers now draw in the conversation, as in pi's terminal. A custom message an extension draws with `registerMessageRenderer` shows that drawing; one without a renderer shows its type and its content instead of "Unrecognized message". A custom entry an extension draws with `registerEntryRenderer` (for example pi-subagents' "reply sent to" rows) now shows, live and after a reload. A PI WEB plugin that draws the type still draws it its own way, and plugins now learn whether a row is a message or an entry and what the extension drew. Rows read before a session runs in PI WEB show the plain content until the page reads the session again. Restart the session daemon and reload the page.
