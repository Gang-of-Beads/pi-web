---
"@gang-of-beads/pi-web": patch
---

Extension UI fixes from review. An extension widget drawn by a component no longer runs on every status update (a long shell output used to redraw it once per chunk in the session daemon); it redraws when it asks, at most once a second otherwise, and its cut note now counts the lines it cut. A notify with a level other than info, warning or error shows as an info line instead of vanishing; a warning or an error that arrives while you read older messages appears when you return to the latest. Reloading a session's extensions clears their statuses and widgets as the reload starts, closing a session stops showing them, and hiding the working row keeps the turn clock. The status line's open list scrolls within 40% of the screen and folds when you open another session, a notice line lines up with the messages and has a full tap target, and an extension's tab title keeps the π mark. Restart the session daemon, then reload the browser.
