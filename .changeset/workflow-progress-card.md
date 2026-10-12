---
"@gang-of-beads/pi-web": patch
---

A `workflow` tool call (the pi-dynamic-workflows extension) is drawn as a progress card in the conversation: the workflow's counts and a bar, then each phase with its agents and a status for each (a failed agent shows its error when the extension reports one; pi-dynamic-workflows 1.0.1 does not yet). It follows the call live. Plugins can draw any tool's rows the same way with the new `toolRenderers` contribution. Reload the page to pick this up.
