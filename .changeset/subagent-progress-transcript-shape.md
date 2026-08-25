---
"@vincenthanxiaodu/pi-web": patch
---

Let a running subagent say what it is doing, and open. The reader that summarises a child's transcript looked for `content` on the transcript line, but pi writes the model message wrapped: `{"type":"message","message":{"content":[…]}}`. Nothing matched in any real transcript, so a run that had not written its result yet reported no steps: its row showed only "working", and opening it answered "No output for this subagent run" — which is every run while it is still running. The existing fixtures used the flat shape the reader assumed, so they agreed with the bug.
