---
"@vincenthanxiaodu/pi-web": patch
---

Read a background task's log without it becoming something the agent said. Opening a task or a subagent run from the activity list wrote its output into the transcript as a tool message: a turn that never happened, attributed to the agent, appended again on every click and gone on the next reload. A log is a file, so it now opens in a view of its own and the conversation is left alone. A task whose log file exists but is still empty used to look readable and then appear to do nothing at all when opened; the viewer now says the log has not been written to yet.
