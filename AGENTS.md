# Agent Notes

Guidance for coding agents, and the people driving them, working in this repository. Contributor workflow (setup, checks, changesets, pull requests) is in [CONTRIBUTING.md](CONTRIBUTING.md).

A gitignored `AGENTS.local.md` next to this file may extend these notes with one machine's environment: its service names, its dev stack, its accounts and tools. Read it when it exists; never commit it.

## Process model

PI WEB runs as two processes. The session daemon (`src/server/sessiond.ts`; `pnpm run start:sessiond`, or `pnpm run dev:sessiond`) owns the running pi sessions and is long-lived: it does not autoreload. The web/API process (`pnpm run dev:web`) and the Vite UI (`pnpm run dev:client`) autoreload in development. Browser disconnects and web/API restarts must not stop active pi sessions.

If a change affects `src/server/sessiond.ts`, session runtime ownership, the session daemon protocol, or any code path only the session daemon loads, say that the session daemon needs a manual restart. Restart order and the startup ownership claim are documented in [docs/install.md](docs/install.md).

Changes to the web/API/UI side only need the web process to restart, which the dev scripts do on their own.

## Server layout: process ownership

`src/server/` is organized by which process loads a module. `src/server/index.ts` and `src/server/sessiond.ts` are the two entry points and stay at the root; everything else lives under exactly one of:

- `src/server/web/` — loaded only by the web/API process (routes, proxies, machines/fleet, browser machine access, static serving). The web process also assembles its own server-plugin runtime for plugins declared `runs: "web" | "both"` and mounts their contributed routes under `/api` and `/api/machines/local`.
- `src/server/daemon/` — loaded only by the session daemon (sessions, terminals, realtime hub, status, workspace providers).
- `src/server/shared/` — loaded by both processes (project store, plugin catalog/runtime, the sessiond client under `shared/sessiondClient/`).

Keep new modules in the directory matching the process that imports them. A `web/` module must never import from `daemon/` (or vice versa); if both sides need it, it belongs in `shared/` (`src/server/processOwnership.test.ts` checks this). Don't reintroduce process-ambiguous modules at the root.

The other trees: `src/client/` is the browser app, `src/shared/` holds the types and parsers the server and the browser share, `src/nativeServices/` installs and drives the systemd and launchd services, `pi-web-plugins/` holds the bundled plugins, and `packages/pi-web-plugin-api/` is the types-only plugin API package.

## Documentation boundaries

`README.md` is a concise landing page and quick start. Keep it focused on what PI WEB is, basic requirements, the shortest supported install path, essential commands, the core model, and links to detailed documentation.

Put installation variants, troubleshooting, configuration details, operational behavior, architecture, edge cases, and exhaustive explanations under `docs/`, as Markdown. Avoid duplicating detailed documentation in the README; link to its canonical location instead.

Use `.agents/skills/documentation-guide/SKILL.md` whenever writing, modifying, reviewing, or planning user-facing documentation.

## Testing guidance

`pnpm run verify` (typecheck, lint, Knip and the Vitest suite) runs locally before a change reaches main (the pre-push hook runs it for a push to main) and in CI on every pull request, every push to main and every release tag. The pre-commit hook runs static checks only. There is no committed Playwright probe or e2e suite.

Maintainer agents do not write new unit tests unless asked (maintainer rule, 2026-10-03); they keep the suite green by fixing the code, or by updating or deleting a test that pinned removed behavior. Outside contributors may, and should, add tests with their change.

Project-specific testing rules live in `.agents/skills/testing-guide/SKILL.md`. Use that skill whenever writing, modifying, reviewing, or planning tests, closing coverage gaps, triaging test failures, or creating test helpers.

## Verification reporting

Never report failed, incomplete, or skipped verification as passing. Identify any expected check that was not run and why, and do not mask a non-zero result. If a command intentionally probes a failure path or captures an exit for inspection, state that purpose and interpret the result. Capture exit codes explicitly: piping a command into `tail`, or appending `echo` after it, hides its exit status.

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

## Code style

- No inline comments. Write self-explanatory code; a comment that narrates what the next line does is noise. Docstrings on modules, classes, and non-obvious functions are welcome when they carry the "why": design rationale, invariants, the report that motivated the shape.
- Design before code: name the module boundary, what it encapsulates, and what it exposes. Prefer small cohesive modules over growth inside an existing large file. New behavior gets its own unit when it has its own reason to change.
- Prefer state machines and enums over string comparison and if/else ladders. A branchy decision that appears twice or carries product meaning gets its states named in one pure classifier (see `revisionVerdict`, `replayDecision`, `bottomAnchorAction`, `promptDeliveryBehavior`); callers stay dumb executors, and a `Record` keyed by the state type makes an unhandled state a type error.
- Keep cyclomatic complexity down: early returns over nesting, lookup tables over switch ladders, extraction over accumulation. If a function needs a paragraph to explain its branches, it wants to be a classifier plus executors.
- Encapsulation is real: a module owns its state and its invariants; callers do not reach in. Data that crosses a boundary carries the scope it belongs to (machine + project + workspace + session).
- The repository is public and English only: no personal names, private hosts, home directories or internal service names in code, tests, fixtures or docs.

## Git etiquette

- Never `git add -A`, `git add .`, or `git add -u` across the tree. Read `git status --short` first, then stage the exact files the change touched, by path. Untracked scratch (checklists, screenshots, temporary artifacts) stays untracked.
- One coherent change per commit, committed as soon as it is green. The subject says what changed, in plain English and the present tense; the body says why, citing the issue or report that motivated it when there is one.
- User-visible changes carry a `patch` changeset in the same commit (see the changeset skill). Never use `minor`: the version is `MAJOR.YYYYMM.PATCH` and the month is set at release.
- Run `pnpm run verify` before a change reaches main.
- Pull requests get a real review before merge; never claim a pull request merged without checking that `gh pr view` says so.

## Verification workflow

Before a non-trivial change is called done:

1. **Independent review.** Run at least two independent review passes over the diff (separate reviewers or review agents), each given the diff, the live file paths and a directed list of what to hunt for, and each required to return file:line findings with a minimal failure scenario and a true/false verdict on every suspicion. Triage every finding in writing (fixed / not fixed, with the reason / judged not true) in a scratch file outside the repository, before fixing. Triage records are not committed; the commit that lands the fixes states each outcome in its message. When two reviewers disagree, read the source rather than trusting either.
2. **Live verification.** Build and run the change on an isolated dev stack (`scripts/stack-8505.sh up` runs one on port 8505 with its own data dir), then drive the real UI in a real browser against a real session daemon for the touched flows: desktop, and a coarse-pointer 393x850 viewport where the surface is phone-relevant. Record what was checked. A check must fail loudly on a missing precondition rather than pass empty, and daemon-side claims are checked against the daemon's logs.

## How we work

### Design the whole before patching the part

A reported symptom is a request to understand the system, not permission to patch the spot where it showed. Before code: name the surface, the scope it acts on, and how it relates to the currently open session. Write the design down so it can be corrected on paper; a page someone has to use before discovering it is wrong is the expensive way to find out.

### Product semantics belong to the maintainers

Do not decide user-visible behavior alone. Present the options and their costs and let the maintainers choose. A fix that trades "empty" for "wrong" (for example, keeping a previous list on screen while a new one loads, so it shows another project's data with live actions on it) is worse than the bug it fixes.

### Verify your own work

A green unit suite is not evidence that a person can use the feature. Before committing UI-affecting work, exercise it the way a user does and record the numbers. If a probe cannot reproduce the defect, say "not reproduced"; never present an unverified leg as verified, and never let a server that died mid-test read as "the bug is gone".

### Data must carry the scope it belongs to

Any cached or retained value must travel with the key it was fetched for (machine + project + workspace + session, as applicable) and must not render, and must not be actionable, when that key does not match the current selection. Retention across loading or failure is legitimate only for the same key.

### Absence is not negation

An empty list means "unloaded or empty", not "empty". A missing transcript means "not written yet or gone", not "gone". A refused request that answers with a snapshot must still say it refused. Every state that can be unknown needs an explicit unknown, rendered honestly.

### Consistency is designed, not corrected

Grid tiles share a height; titles clamp to a fixed line count; every interactive target meets the coarse-pointer floor. Decide these when the surface is built.

### The same symptom reported twice stops the patching

Enumerate every producer, write down the invariant being violated, then change code. Fixing one producer and leaving its siblings is how the same complaint comes back.

### State machines over ladders

When a branchy decision appears twice or carries product meaning, name its states and transitions in one pure classifier (see `revisionVerdict`, `replayDecision`) and keep the callers as dumb executors; enumerate every state in tests so an unanswered state fails there instead of in production.
