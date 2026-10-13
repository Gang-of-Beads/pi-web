# PI WEB gives the agent no tools of its own

Owner, 2026-09-30, on sub-sessions filling the session list: "If spawn sub session is pi web's own, remove all of it. pi web only supports it as an API operation, but don't give the AI this tool by default. pi web should not give the AI any extra tools; those should all be defined by the user's own plugins". On `ask_user`, PI WEB's own question tool, he chose: move it into a pi extension shipped with PI WEB, off until enabled.

## What the agent gets from PI WEB today

| Tool | Gated by | Default |
|---|---|---|
| `spawn_session` | `spawnSessions` | on |
| `spawn_subsession`, `list_subsessions`, `check_subsession`, `read_subsession`, `yield_to_subsessions` | `subsessions` (needs `spawnSessions`) | on |
| `ask_user` | `askUser` | on |
| `edit` (pi's own tool, wrapped to compute a diff preview) | none | replaces pi's `edit`, adds nothing |

## After

1. **No delegation tools.**
   - The six spawn and subsession tools are gone.
   - The daemon keeps the operations and exposes them as session routes, so a plugin or extension can build its own tools on them:

     | Route | Operation |
     |---|---|
     | `POST /sessions/:id/spawn` | start an independent session |
     | `POST /sessions/:id/subsessions` | start a tracked child |
     | `GET /sessions/:id/subsessions` | list the children |
     | `GET /sessions/:id/subsessions/:child` | check a child |
     | `GET /sessions/:id/subsessions/:child/transcript` | read a child's transcript |

   - The parent's model and thinking level are read from the parent session, as the tools read them.
   - Project-scope checks are unchanged.
   - The `spawnSessions` and `subsessions` config keys are retired. They are still accepted, so existing files load, but ignored. Their Settings toggles are removed.
   - Existing tracked children keep their links. `GET /sessions/:id/subsessions` lists them, and so does the pi-web-subagents plugin when it is installed.
2. **`ask_user` becomes an extension.**
   - It is an inline pi extension (`askUserExtension` in `askUserTool.ts`, named `pi-web-ask-user`) that registers `ask_user` with the same parameters, prompt text and ending of the run. It is not under `extensions/`: PI WEB is itself a pi package whose `pi.extensions` names that directory, so anything there loads for everyone who installs PI WEB into pi.
   - Built (2026-10-09) as an inline extension rather than the planned file posting to a new `POST /sessions/:id/asks` route: the extension runs inside the daemon that owns the ask store, so it opens the ask directly, and a file would first have had to find the daemon's socket. The daemon's ask store, the Questions card, and the follow-up message carrying the answers are unchanged.
   - The daemon passes the extension to its sessions' resource loader only when `askUser` is on, and `askUser` now defaults to off. The Settings toggle stays.
3. **`edit` stays.** It is pi's own tool with a preview, not an added one.

## Consequences

- After the daemon restarts, a session no longer offers `spawn_session` or the subsession tools. Since 2026-10-11 it offers no `ask_user` either (below).
- Sessions an agent started through the old tools remain ordinary sessions.

## Commits

1. Remove the delegation tools, and add the spawn and subsession routes.
2. Move `ask_user` into the extension, off by default.
3. Delete `ask_user` (2026-10-11, below).

## 2026-10-11: `ask_user` is deleted

Owner, 2026-10-11 (paraphrased): PI WEB should not have an ask_user tool; core must not ship agent features of its own; using PI WEB should be the same as using pure pi TUI, and everything else is a plugin or extension. Step 2 had only turned it off, and its card, ask store, routes and answer delivery stayed in core.

- Deleted: the inline extension and its tool, the `askUser` config key and `PI_WEB_ASK_USER`, the Settings section that held the toggle (Session daemon, which had nothing else), the daemon's ask store and its two routes, the `pendingAsk`/`pendingAsks`/`queuedAnswers` status fields and the `ask.opened`/`ask.closed` frames, and the answers-as-a-message delivery (B26 for answers).
- A config file that still sets `askUser` loads; the key has no effect, and the next save drops it.
- A question tool is a pi extension the user installs (pi-ask-user, for example). Its questions arrive as extension dialogs.
- The Questions card, which drew a screen an extension declared as `questions`, was kept for one more day; on 2026-10-12 it was replaced by the core interactive card (interactive-card.md).
- Old transcripts keep their records: an `ask_user` call reads as an ordinary tool row, and its answers message (`pi-web.ask.answers`) as an ordinary custom message, as pi's terminal shows them.
