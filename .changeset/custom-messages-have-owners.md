---
"@gang-of-beads/pi-web": patch
---

Custom messages get owners instead of a defect notice.

Goal lifecycle events, subagent notices, web searches, browser sessions and
account selections all drew "Unrecognized message". Each now belongs to a
plugin: goals draws its own events, a new subagents plugin draws the run
notices and answers a supervisor request - the reply is sent to this session,
which owns the supervisor tool, and the card says exactly that - and a new
agent-events plugin summarises the agent's own tool bookkeeping. Message
renderers may now insert into the composer or send as the reader.
