---
"@gang-of-beads/pi-web": patch
---

Long sessions hold up the session daemon less. Each status built the session's whole context twice to report its context usage, and copied every entry just to count them; it now builds the context once and asks pi for the count. On a copy of a 67,000-entry session, the pause between a tool's result and the next model request fell from about 530 ms to about 375 ms, and the longest stall other sessions waited behind fell from about 510 ms to about 340 ms. Every value a status shows is computed exactly as before. Restart the session daemon after updating to apply this fix.
