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
   - Existing tracked children keep their links. The Subagents tab keeps listing them.
2. **`ask_user` becomes an extension.**
   - It is an inline pi extension (`askUserExtension` in `askUserTool.ts`, named `pi-web-ask-user`) that registers `ask_user` with the same parameters, prompt text and ending of the run. It is not under `extensions/`: PI WEB is itself a pi package whose `pi.extensions` names that directory, so anything there loads for everyone who installs PI WEB into pi.
   - Built (2026-10-09) as an inline extension rather than the planned file posting to a new `POST /sessions/:id/asks` route: the extension runs inside the daemon that owns the ask store, so it opens the ask directly, and a file would first have had to find the daemon's socket. The daemon's ask store, the Questions card, and the follow-up message carrying the answers are unchanged.
   - The daemon passes the extension to its sessions' resource loader only when `askUser` is on, and `askUser` now defaults to off. The Settings toggle stays.
3. **`edit` stays.** It is pi's own tool with a preview, not an added one.

## Consequences

- After the daemon restarts, a session no longer offers `spawn_session` or the subsession tools. It offers `ask_user` only when you turn it on in Settings.
- Sessions an agent started through the old tools remain ordinary sessions.

## Commits

1. Remove the delegation tools, and add the spawn and subsession routes.
2. Move `ask_user` into the extension, off by default.
