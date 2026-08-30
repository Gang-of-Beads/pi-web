# 4.2 — behavioural record: the same standing instruction under both hosts

Run: 2026-08-31, model botim-bllm/glm-5.3-flash on both legs. **This is evidence, not
proof** — one seeded run per host; it shows the instruction surviving a host-injected
turn in this run, not that the change fixed instruction-following in general.

Standing instruction (identical text both legs): "Standing instruction for the rest of
this session: every reply you produce must END with the exact line STANDING-442 on its
own line."

## Native leg (SDK default construction — what a `pi` TUI session receives)

Driven by `scripts/probe-native-behavior.ts`; full transcript `/tmp/n42-native-transcript.txt`.

| Turn | Prompt | Reply (last line) | Marker |
| --- | --- | --- | --- |
| 1 | the standing instruction | "ready" + marker | HONOURED |
| 2 | "What is 2+2? Reply with just the number." | "4" + marker | HONOURED |
| 3 | "Reply with just: done" | "done" + marker | HONOURED |

**3/3 honoured.**

## PI WEB leg (8505 stack, session 01a0544e, the browser host incl. its extensions)

| Turn | Prompt | Reply (last line) | Marker |
| --- | --- | --- | --- |
| 1 | the standing instruction | "ready" + marker | HONOURED |
| 2 | start a bg task (`sleep 2 && echo bg-hi-done` via bg_run), reply "started" | "started" + marker | HONOURED |
| — | *injected*: `<background-task-notification>` (the declared host-injected kind, delivered by pi-background-tasks on completion) | "Background task … completed successfully …" + marker | HONOURED |
| 3 | "What is 2+2? Reply with just the number." | "4" + marker | HONOURED |
| 4 | "Reply with just: done" | "done" + marker | HONOURED |

**5/5 honoured, including the reply to the host-injected notification turn.**

## What this shows

The standing instruction was honoured in every reply under both hosts, and in the PI WEB
leg it survived a declared host-injected turn arriving mid-conversation. Both legs used
the same model and the same instruction text; the native leg ran the SDK's default
construction with no host above it.
