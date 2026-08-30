# 4.1 — live model-surface capture (8505 stack, session 01a05443)

Run: 2026-08-31 00:01 local. Seeded session in the test project (`/private/tmp/test`), one
turn to a reply ("Reply with exactly: ok" → "ok", botim-bllm/glm-5.3-flash), captured via
the debug-only `GET /api/debug/model-surface` route (`PI_WEB_DEBUG_PROMPT_CAPTURE=1`,
sessiond socket) and diffed against a NATIVE host construction (the SDK's own service
constructor, same cwd, same shared agent dir, same model resolution) built by
`scripts/probe-native-surface.ts`.

## Prompt

| Measure | Value |
| --- | --- |
| Captured (PI WEB host, live) | 38,328 chars |
| Native (SDK default construction) | 37,145 chars |
| pi-web-authored text in the captured prompt | exactly the declared seam block (`<pi_web_session_environment>…`, 871 chars, byte-identified at the hunk level) — no other pi-web-authored text |

The remaining delta is not pi-web-authored:

- `[PI GOAL UNFOCUSED] …` (239 chars) — the pi-goal extension's unfocused-goal notice,
  emitted because the fresh session has no focused goal while open goals exist.
- Tool-guideline text shifts that follow from the tool differences below (the system
  prompt embeds per-tool guidelines, so a tool-set difference propagates into the prompt).

## Tools

| Measure | Value |
| --- | --- |
| Captured | 50 |
| Native | 43 |
| Added (captured only) | `spawn_session`, `spawn_subsession`, `list_subsessions`, `check_subsession`, `read_subsession`, `yield_to_subsessions` (PI WEB's subsession/delegation browser transports), `subagent_supervisor` (the pi-subagents extension's supervisor tool, registered because PI WEB provides the supervisor channel) |
| Removed (native only) | none |
| Rewritten (description differs) | `ask_user` — PI WEB's browser ask gate replaces the native ask tool (the questions land as a browser form; ends the run; answers return as a follow-up) |

## Verdict (evidence, stated exactly)

- "No pi-web-authored text" beyond the declared seam section: **holds** (hunk-level).
- "The tool list matches the native host's": **does not hold literally** — the seven
  delegation/subsession transport tools and the supervisor-channel tool are present only
  under PI WEB, and `ask_user` is the browser gate's variant. These rows are the
  dispositions recorded in task 2.1 (browser transports for pi-native capabilities), not
  undeclared additions; their justification lives there.

## Artifacts

- `captured-system-prompt.txt` — the exact system prompt the live session was constructed with.
- `native-system-prompt.txt` — the native host's prompt over the same inputs.
- `tool-diff.txt` — the probe's tool diff summary.
- `session-reply.png` — the seeded session's reply in the browser (393×850).
