---
"@vincenthanxiaodu/pi-web": patch
---

Open a subagent run as the conversation it is.

The two kinds of activity row told the same work two different ways: a
subsession row opened the session it named, while an agent-run row opened a
block of text. A run does have a conversation, so clicking one now shows it,
labelled as a child run of the session it belongs to. A run that never opened a
transcript still falls back to whatever it returned.

Two kinds of child write two different files under names that look alike. A
fresh-context child gets a run directory holding an ordinary session `jsonl`. A
fork-context child — which is what the builtin `worker` and `oracle` agents are,
so the common case — never creates that directory; the subagent tool keeps its
own event log in the shared artifacts directory instead. The two were assumed to
be the same file because of the name: projected as a session branch, a real fork
transcript of 254 entries yielded zero messages. The event log is adapted rather
than the session walk being widened, because the difference is in the data.

Reading only, and the view says so. Steering, resuming or interrupting a live
child travels over the subagent extension's RPC — `SUBAGENT_RPC_METHODS` at
`src/extension/rpc.ts:34` — which rides the in-process Pi event bus:
`SUBAGENT_RPC_REQUEST_EVENT` at `rpc.ts:30`, subscribed at `rpc.ts:776`, wired
through `pi.events` at `src/extension/index.ts:668-778`. A caller must hold that
bus inside the agent process that loaded the extension, and the web/API process
never does. The session daemon is a different matter: it hosts the Pi agent
process that loaded the extension in the first place, so the way to offer
intervention is to expose that RPC over the socket the daemon already serves —
not to give the web server `pi.events`. An unexplained missing control reads as
an unfinished feature, so the conversation states the boundary instead.
