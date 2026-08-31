---
"pi-web": patch
---

The activity chip says "compacting" during /compact instead of the generic "updating session": the entry mutation the compaction runs inside no longer masks the specific state.
