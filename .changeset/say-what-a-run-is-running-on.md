---
"@vincenthanxiaodu/pi-web": patch
---

Show which model and thinking level a subagent run is using

A fleet of running agents gave no way to tell which was on which model, or at
what thinking level - the two things that decide what a run costs and how long
it takes. The run already recorded it as `provider/model:thinking`; the row
just never showed it. Rows now read "claude-opus-5 · medium", keep the full
identifier in the tooltip, and say it to assistive technology too.
