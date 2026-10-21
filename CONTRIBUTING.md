# Contributing to PI WEB

Thanks for helping. This page covers how to set up a checkout, what a change needs before it can merge, and how pull requests are reviewed. Everyone taking part follows the [Code of Conduct](https://github.com/Gang-of-Beads/.github/blob/main/CODE_OF_CONDUCT.md). To report a security problem, follow [SECURITY.md](SECURITY.md) instead of opening an issue.

## Before you start

Open an issue before working on anything larger than a small fix. User-visible behavior is decided by the maintainers, and agreeing on the design first saves rework on both sides. Bug reports and feature requests have issue templates.

## Requirements

- Node.js 22.19.0 or newer (`engines` in `package.json`)
- pnpm 12.8.1 (`packageManager` in `package.json`)
- git
- Pi Coding Agent 1.3.0 or newer, configured for your user, to run sessions
- A C/C++ toolchain and Python 3 for the node-pty build during `pnpm install` (`nix develop` provides them)

## Setup

```bash
git clone https://github.com/Gang-of-Beads/pi-web.git
cd pi-web
pnpm install --frozen-lockfile
```

Installing runs the `pnpm:devPreinstall` script, which points git at the repository's hooks (`git config core.hooksPath .githooks`).

## Running it

```bash
pnpm run dev
```

This starts the session daemon, the web/API process and the Vite UI. The UI listens on every interface (`0.0.0.0:8505`) and has no authentication, so do this only on a network you trust. Open `http://localhost:8505`; the UI proxies `/api` to the web/API port from your PI WEB config (8504 by default). To run the pieces separately, use `pnpm run dev:sessiond`, `pnpm run dev:web` and `pnpm run dev:client`.

If you already run PI WEB on this machine, keep the development copy apart from it: set `PI_WEB_DATA_DIR` to another directory for every process you start, and `PI_WEB_PORT` to another port for the web/API process and the UI (the UI itself always listens on 8505). `scripts/stack-8505.sh up` builds and runs an isolated stack on port 8505 with its own data dir and never touches processes it did not start; it needs bash, tmux, lsof and curl, takes the same port as `pnpm run dev` (run one or the other), and keeps its config and pi agent directory apart from yours when you set `PI_WEB_8505_CONFIG` and `PI_WEB_8505_AGENT_DIR`. Run one test file with `pnpm exec vitest run path/to/file.test.ts`.

`pnpm run dev:sessiond` restarts the session daemon whenever a file it loads changes, which stops the sessions it runs. To keep sessions alive while you edit, run `pnpm run start:sessiond` instead, which does not reload, and restart it by hand after a change to `src/server/sessiond.ts`, to anything under `src/server/daemon/` or `src/server/shared/`, or to the daemon protocol. The web/API process and the UI reload on their own.

## Code layout and style

[AGENTS.md](AGENTS.md) is the short reference for how the code is organized and written; it applies to people and coding agents alike. The main points:

- `src/server/` is split by process: `web/` for the web/API process, `daemon/` for the session daemon, `shared/` for both. A `web/` module never imports from `daemon/` or the reverse.
- No comments that narrate the next line. Docstrings explain why: the rationale, the invariant, the report that motivated the shape.
- A decision with product meaning is a named-state classifier, not an if/else ladder.
- Data that crosses a boundary carries the scope it belongs to (machine, project, workspace, session).
- English only, and no personal names, private hosts or home directories in code, tests or docs.

## Testing and verification

Run the full check before you open a pull request:

```bash
pnpm run verify
```

It runs the typecheck, ESLint, Knip and the Vitest suite. CI runs the same command on every pull request, on Node 22 and Node 24.

Add tests with your change where they prove something a reviewer would otherwise have to take on trust; [.agents/skills/testing-guide/SKILL.md](.agents/skills/testing-guide/SKILL.md) describes the conventions (test layers, the happy-dom harness for Lit components). When a change breaks an existing test, fix the code, or update or delete the test if it pinned behavior the change removes on purpose.

A green suite does not show that a person can use the change. For anything that touches the UI, try it in a real browser against a running session daemon, at desktop size and in a 393x850 viewport with a coarse (touch) pointer, and say in the pull request what you checked.

## Git hooks

- **pre-commit** runs `pnpm run verify:staged`: the typecheck, Knip, and ESLint on the staged files.
- **pre-push** refuses a push while tracked files under `src/`, `extensions/` or `pi-web-plugins/` have uncommitted changes, and runs the full `pnpm run verify` when the push targets `main`.

## Changesets

Every user-visible change carries a changeset in the same commit:

```bash
pnpm run changeset
```

Always choose `patch`. Never use `minor`: versions are `MAJOR.YYYYMM.PATCH`, and the month is set when a release is cut. `major` is reserved for a breaking release the maintainers have agreed on. Write the text for users: what changed for them, in a sentence or two, without naming people, private hosts or internal test setups. Changes outside the published package (tests, CI, agent guidance, repository-only docs) do not need one.

## Commits

- One coherent change per commit.
- The subject says what changed, in plain English and the present tense, for example `Keep the composer draft when the daemon restarts`. The body says why, and cites the issue it fixes.
- Stage files by path. Do not sweep unrelated files in with `git add -A` or `git add .`.

## Pull requests

The pull request template asks for:

- what changed and why, with the linked issue;
- the changeset, or "not user-visible";
- the `pnpm run verify` result and the browser checks you did (sizes, flows);
- whether the change needs a session daemon restart.

A maintainer reviews every pull request before it merges.

## Plugins

Plugins outside the bundled set live in their own repositories; [docs/plugins.md](docs/plugins.md#packages) lists the ones the project maintains. Start with [docs/plugins.md](docs/plugins.md) for how plugins are installed and enabled, and [docs/plugin-authoring.md](docs/plugin-authoring.md) to write one.

## Maintainer tooling

- [docs/releasing.md](docs/releasing.md) describes how a release is cut and published.
- `bob.config.json` configures an optional review agent some maintainers run locally. Contributors do not need it.
