---
"@gang-of-beads/pi-web": patch
---

The durable queue arc survived its own adversarial review. Parked prompts now drain on the runtime's true settle signal with a heartbeat backstop, a refused submission restores the entry instead of destroying it, restart retries settle as duplicates instead of running twice, queue persistence is serialized with corrupt files quarantined and logged, and the unsent-message flush deletes exactly what was accepted - a message discarded mid-flush stays discarded, and another session's unsent rows can never render here.
