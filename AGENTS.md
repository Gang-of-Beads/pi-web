# Agent Notes

This project is expected to run locally using split systemd user services:

- `pi-web-sessiond.service` runs `npm run start:sessiond` in non-autoreload, non-auto-restart mode.
- `pi-web-ui-dev.service` runs the web/API and Vite UI in dev autoreload mode with `npm run dev:web` and `npm run dev:client`.

When working on this project, assume the session runtime owner is long-lived and separate from the autoreloading UI/API process. Browser disconnects and UI/API restarts should not stop active Pi sessions.

If you make changes that affect `src/server/sessiond.ts`, session runtime ownership, the session daemon protocol, or any code path only loaded by the session daemon, inform the user that a manual restart of the session daemon is needed. Restart order, the startup ownership claim, and second-instance requirements are documented in `docs/install.html` ("Session daemon ownership and restarts").

Changes to the web/API/UI side generally only require the `pi-web-ui-dev.service` autoreload/restart path.

## Documentation boundaries

`README.md` is a concise landing page and quick start. Keep it focused on what PI WEB is, basic requirements, the shortest supported install path, essential commands, the core model, and links to detailed documentation.

Put installation variants, troubleshooting, configuration details, operational behavior, architecture, edge cases, and exhaustive explanations under `docs/`. Avoid duplicating detailed documentation in the README; link to its canonical location instead.

Use `.agents/skills/documentation-guide/SKILL.md` whenever writing, modifying, reviewing, or planning user-facing documentation.

## Testing guidance

Project-specific testing rules live in `.agents/skills/testing-guide/SKILL.md`.

Use that skill whenever writing, modifying, reviewing, or planning tests, closing coverage gaps, triaging test failures, or creating test helpers/harnesses. Keep detailed testing conventions there rather than growing this top-level orientation file.

## Verification reporting

Never report failed, incomplete, or skipped verification as passing. Identify any expected check that was not run and why, and do not mask a non-zero result. If a command intentionally probes a failure path or captures an exit for inspection, state that purpose and interpret the result.

## Client application URL convention

- Build PI WEB-owned browser paths as application-relative references without a leading slash, for example `api/...` and `pi-web-plugins/...`.
- Encode every dynamic path segment with `encodeURIComponent`; encode query values, using `URLSearchParams` for multi-field queries.
- Resolve each reference exactly once at the browser boundary: ordinary JSON HTTP paths go to `request()`, direct browser APIs receive URLs from helpers backed by `resolveAppUrl()`, and WebSockets use `resolveAppWebSocketUrl()`.
- Name helpers returning unresolved application references with a `Path` suffix and helpers returning browser-ready absolute values with a `Url` suffix.
- Plugin module references must go through `resolvePluginModuleUrl()`. Its leading-slash handling is the documented rolling-compatibility exception; do not introduce other leading-root app references.
- Pre-JavaScript HTML assets use Vite `%BASE_URL%`; PWA manifest references stay `./`-relative. External links, data URLs, and module-relative plugin assets are not application paths.
- To assess deviations, search production client code for raw `fetch`, `WebSocket`, `XMLHttpRequest`, URL-bearing DOM attributes, and leading `/api` or `/pi-web-plugins` literals. Every app-owned result must follow one of the boundaries above.
- Published nested deployments require a canonical trailing slash; the reverse proxy must redirect a slashless prefix before serving the app.

## Configuration conventions

- `$PI_WEB_DATA_DIR` (`~/.pi-web` by default) contains PI WEB-managed state such as `projects.json` and `machines.json`; do not treat it as the user-editable config API.
- Global user/machine config lives at `$PI_WEB_CONFIG` or `~/.config/pi-web/config.json`.
- Project-local PI WEB core config should use one commit-able file: `<project>/.pi-web/config.json`.
- Core features should add keys to these config files, not create one project file per feature.
- Plugins may own separate project config files, such as `.pi-web/tasks.json`.

## How we work

These are the owner's standing rules. They exist because breaking each one cost real damage on this project, and the cost is recorded so nobody has to relearn it.

### Design the whole before patching the part

A reported symptom is a request to understand the system, not permission to patch the spot where it showed. Before code: name the surface, the scope it acts on, and how it relates to the currently open session. Ship a design the owner can correct on paper; a page he has to use before discovering it is wrong is the expensive way to find out.

### Product semantics belong to the owner

Do not decide user-visible behavior alone. Present the options and their costs and let the owner choose. Two unilateral decisions did real harm here: a read-only modal was built where a navigable page was asked for, and "keep the previous list while loading or on error" was invented to stop a panel from disappearing - it then rendered another project's goal, with a live Abandon button on it. Trading "empty" for "wrong" is worse than the bug being fixed.

### Verify your own work before it reaches the owner

A green unit suite is not evidence that a person can use the feature. Before committing UI-affecting work, exercise it the way a user does - the 8505 stack, a real browser, a coarse pointer at 393x850 - and record the numbers. Read the daemon logs for daemon-side claims. If a probe cannot reproduce the defect, say "not reproduced"; never present an unverified leg as verified, and never let a server that died mid-test read as "the bug is gone".

### Data must carry the scope it belongs to

Any cached or retained value must travel with the key it was fetched for (machine + project + workspace + session, as applicable) and must not render, and must not be actionable, when that key does not match the current selection. Retention across loading or failure is legitimate only for the same key.

### Absence is not negation

An empty list means "unloaded or empty", not "empty". A missing transcript means "not written yet or gone", not "gone". A refused request that answers with a snapshot must still say it refused. Every state that can be unknown needs an explicit unknown, rendered honestly.

### Consistency is designed, not corrected

Grid tiles share a height; titles clamp to a fixed line count; every interactive target meets the coarse-pointer floor. Decide these when the surface is built. "The boxes are different sizes" should never be something the owner has to report.

### The same symptom reported twice stops the patching

Enumerate every producer, write down the invariant being violated, then change code. Fixing one producer and leaving its siblings is how this project produced the same complaint five times.

### The goal plugin's design (owner's definition)

A goal belongs to a project. One session focuses it at a time; focusing elsewhere releases it. Focus, pause and resume are available to the user and to the agent itself. While a subagent run or a background task is active, the continuation is not injected - it waits for quiescence, with a bounded fallback so lost work cannot stall a goal forever.

### Operational rules that cost us time

- Never use heredocs or `cat >` in agent shell commands; four runs hung on an unterminated heredoc. Use file-writing tools.
- Prefer explicit state machines over if/else ladders. When a branchy decision appears twice or carries product meaning, name its states and transitions in one pure classifier (see `revisionVerdict`, `replayDecision`) and keep the callers as dumb executors; enumerate every state in tests so an unanswered state fails there instead of in production.
- Commit each coherent piece the moment it is green. Two runs were killed by a 30-minute wall with uncommitted work.
- Push extension/fork work immediately. The package updater hard-resets those repos to upstream; unpushed commits were destroyed twice.
- Capture exit codes explicitly. A trailing `echo EXIT=$?` masked a killed release chain, and piping a verify into `tail` masked a failure.
