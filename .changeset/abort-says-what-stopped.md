---
"@vincenthanxiaodu/pi-web": patch
---

Say what an aborted turn was doing when it stopped. "Model response failed: This operation was aborted" is equally true of a cancelled turn, a tool that hung, and a stop the reader pressed — so on its own it left the reader to reconstruct which. The failed message still carries the tool it was calling, so the line now names it: "(stopped while running bash)", or "(the turn was stopped before it finished)" when no tool was in flight.
