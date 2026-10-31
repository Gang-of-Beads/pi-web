---
"@gang-of-beads/pi-web": patch
---

When a session opens, the composer shows its model and thinking-level buttons at once with a loading spinner until the session's status arrives, instead of an empty row that filled in later; if the status cannot come (for example a new session the machine refused to start), the buttons stay still and read "Model unknown" and "?".
