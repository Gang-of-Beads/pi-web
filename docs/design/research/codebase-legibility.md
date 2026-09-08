# Research: Making the PI WEB codebase legible and maintainable at this size and shape

## Tooling disclosure (read first)

This run was launched with **only `Read` and `Write`**. No `web_search`, no fetch, no `source_check`, no shell.
Consequences, stated honestly rather than hidden:

- **Every repo claim below is direct evidence**: I read the file and I name the file and what I saw. Line counts come from the reader's own truncation notice (e.g. "5821 more lines in file" after a 5-line read → 5826 lines).
- **Every external claim is UNVERIFIED-IN-RUN.** I cite the canonical primary URL where I am confident the source exists, but I could not fetch it, so I do not quote it, do not cite versions, options, or benchmark numbers from it, and I mark each one. Treat external URLs as "go read this before adopting", not as validated evidence.
- I could not enumerate directories (no `ls`/glob). The tree survey below is built from **import graphs of the two entry points plus `PiWebApp.ts`**, which is strong evidence for the modules that exist and are used, and **no evidence at all** about modules nothing I read imports. Where I could not confirm a path, I say so.

## Summary

The process split (`src/server/{web,daemon,shared}`) is **honest but unenforced**: it is a documented convention in `AGENTS.md` with zero machine checking, and the two entry-point import graphs I read do respect it. The real legibility debt is not the layout, it is **four accumulation sites** — `src/server/daemon/sessions/piSessionService.ts` (5,826 lines), `src/client/src/components/PiWebApp.ts` (3,983), `src/client/src/components/ChatView.ts` (2,389), `src/shared/apiTypes.ts` (1,603) — plus a single 271-line global `AppState` bag and a flat, layer-sliced client root where ~50 pure classifier modules sit unsorted next to each other. The highest-leverage moves, in order, are: (1) make the boundary a lint rule instead of a paragraph, (2) turn classifier dispatch from `switch` into `Record<State, X>` lookup tables so an unhandled state is a **compile** error rather than a lint error, (3) continue the extraction pattern those god files already demonstrate rather than attempting re-architecture.

## Findings

### A. Where the split is honest, and where it drifts

1. **Claim:** The process-ownership split is real in the code, not just in the docs. `src/server/index.ts` (7 lines) imports only `./web/app.js` + `../config.js`; `src/server/sessiond.ts` imports ~30 modules, all from `./daemon/*`, `./shared/*`, or `../{config,shared,serverPluginRecovery}`. `src/server/web/app.ts` imports from `./` and `../shared/` only. I saw **no `web/`→`daemon/` or `daemon/`→`web/` import** in either graph.
   **Sources:** `src/server/index.ts`, `src/server/sessiond.ts`, `src/server/web/app.ts` (read directly).
   **Support:** direct evidence (for the files read) + researcher inference (that the whole tree obeys it — I could not enumerate the tree, so this is *not* proven).
   **Confidence:** high for the entry graphs, low as a whole-tree claim.

2. **Claim:** That split is enforced by **nothing mechanical**. `eslint.config.js` has one flat block covering `src/**`, `extensions/**`, `pi-web-plugins/**`, `plugins/**` with type-checked rules but **no import/boundary rule of any kind** — no `no-restricted-imports`, no `eslint-plugin-boundaries`, no dependency-cruiser (absent from `devDependencies` in `package.json`). `tsconfig.json` is a **single project** with no project references and `paths` only for the two plugin-API entry points. CI (`.github/workflows/ci.yml`) runs `npm run verify` = `typecheck && lint && knip && test`; none of those can see a `web/ → daemon/` import.
   **Sources:** `eslint.config.js`, `tsconfig.json`, `package.json`, `.github/workflows/ci.yml`, `knip.json` (read directly).
   **Support:** direct evidence.
   **Confidence:** high.
   **Failure mode this leaves open:** the first `web/` module that imports a `daemon/` module compiles, lints, tests green, and ships — and then the web process pulls session-daemon code into a process that must not own sessions. The rule that makes the tree legible is exactly the rule with no guard.

3. **Claim:** The client is **layer-sliced with a large flat root**, not feature-sliced. From `PiWebApp.ts`'s import list: layers exist (`components/`, `controllers/`, `plugins/`, `appShell/`, `api/`, `runtime/`), but ~40 single-purpose modules sit flat at `src/client/src/`: `composerCollapse`, `bannerHold`, `sessionActivityPolling`, `sessionWaiting`, `sessionUnread`, `sessionPins`, `sessionCleanupUi`, `workspaceDeletion`, `workspaceViewTransition`, `transcriptInvariant`, `versionSkew`, `routeMatch`, `route`, `settingsRoute`, `quickSwitcher`, `commandLedger`, `keyboardDismissal`, `keyboardShortcuts`, `shortcutPreferences`, `historyWrites`, `machineKeys`, `namespacedQueryArgs`, `notice`, `errorNotice`, `resendMessage`, `contextName`, `theme`, `appState`, `actions`, `breakpoints`, `pwaDisplayMode`, `scrollbarWidth`, `chatScrollPosition`, and more.
   **Sources:** `src/client/src/components/PiWebApp.ts` (import block, lines 1–90); `src/client/src/composerCollapse.ts`; `src/client/src/appShell/appShellController.ts`.
   **Support:** direct evidence.
   **Confidence:** high.
   **Reading:** this flat root is not sloppiness — it is the **owner's classifier rule working**. Each of those files is a small pure module with a docstring carrying the incident. The cost is that nothing groups `sessionUnread` + `sessionPins` + `sessionActivityPolling` + `sessionWaiting` into "the session-activity feature", so the only place the feature is assembled is inside the god component.

4. **Claim:** Four accumulation sites carry the weight. Verified line counts: `src/server/daemon/sessions/piSessionService.ts` **5,826**; `src/client/src/components/PiWebApp.ts` **3,983**; `src/client/src/components/ChatView.ts` **2,389**; `src/shared/apiTypes.ts` **1,603**; `src/server/daemon/sessions/sessionRoutes.ts` **861**; `src/client/src/appState.ts` **271** (a single `AppState` interface).
   **Sources:** direct reads of each file (counts from reader truncation notices).
   **Support:** direct evidence.
   **Confidence:** high.

5. **Claim:** `PiWebApp.ts` is a god component **by concern count**, not merely by length. In the 150 lines I read (700–849) it owns: unread acknowledgement + "ready chat identity" commit-after-render, interrupted-run adoption, subagent/background-task polling with an in-flight guard, self-update check with a 60s cooldown and a `localStorage` skip key, transient-error scheduling, and a stale-client reload banner — plus, from its imports, theme resolution, plugin dialog hosting, routing, panel collapse/resize, quick switcher, keyboard shortcuts, and every controller.
   **Sources:** `src/client/src/components/PiWebApp.ts` lines 700–849 and the import block.
   **Support:** direct evidence.
   **Confidence:** high.
   **Failure mode:** every new feature has one obvious home, and it is this file; the "same symptom reported twice" rule is hardest to obey here because the producers of a behavior are interleaved with unrelated ones.

6. **Claim:** `src/server/web/app.ts` is a **composition root with duplicated mounting**, not a god file by size (~330 lines) but by responsibility: it constructs ~12 services with `??` defaults, assembles a second server-plugin runtime inline (~60 lines inside `buildApp`), mounts static files, and defines the SPA 404 policy. It hand-writes the dual-prefix mount **eight times** (`registerX(app, …)` then `registerX(app, …, "/api/machines/local")` for pi-package, config, local-project, session-proxy, project-trust, terminal-proxy, workspace-deletion, plugin routes).
   **Sources:** `src/server/web/app.ts` (read in full).
   **Support:** direct evidence.
   **Confidence:** high.
   **Failure mode:** a ninth route family gets registered on `/api` and forgotten on `/api/machines/local`; the local machine silently lacks a capability the remote path has. This is precisely the "enumerate every producer" rule expressed as a data structure problem.

7. **Claim:** `src/server/sessiond.ts` does **module-load-time side effects**: it mutates `process.env` (`PI_CODING_AGENT_DIR_ENV`, session-dir override, `PI_WEB_SESSION_ENV`), constructs Fastify, scrubs env keys, and `await`s `claimSessiondStateOwnership` at top level before any function is called.
   **Sources:** `src/server/sessiond.ts` (read in full).
   **Support:** direct evidence.
   **Confidence:** high.
   **Note (interpretation, and a real tension):** `code-quality-architecture/SKILL.md` says "Avoid work at import time; make startup, registration, listeners, timers, and connections explicit." The daemon violates that literally — but the ordering is load-bearing and documented in docstrings (env must be canonical *before* anything agent-visible can spawn; ownership must be claimed *before* any store touches state). This is a legitimate entry-point exception, and the cost is that `sessiond.ts` is **not importable by a test**. That is the concrete maintainability price, and it is the argument for extracting a `createSessionDaemon(env)` factory rather than for "cleaning up" the ordering.

8. **Claim:** Test discipline is already strong and colocated: `vitest.config.ts` includes `src/**/*.test.ts` and `pi-web-plugins/**/*.test.ts`, with **per-file** happy-dom opt-in and a comment forbidding a global DOM environment; `testing-guide/SKILL.md` ranks pure-seam > happy-dom > TemplateResult extraction and names existing pure seams (`sessiondPanelNotices`, `chatQueuedMessageSections`).
   **Sources:** `vitest.config.ts`, `.agents/skills/testing-guide/SKILL.md`.
   **Support:** direct evidence.
   **Confidence:** high.

9. **Claim (gap worth naming):** The Playwright e2e suite exists (`e2e` / `e2e:mobile` scripts, `@playwright/test` devDependency) but **`.github/workflows/ci.yml` never runs it**. CI = verify + build + Linux package-install smoke + `pack:dry`. The owner's standing rule ("Live Playwright verification on the 8505 stack") is therefore a **human ritual with no CI backstop**.
   **Sources:** `package.json`, `.github/workflows/ci.yml`.
   **Support:** direct evidence.
   **Confidence:** high.

10. **Claim:** I could **not locate openspec in this repo.** `openspec/project.md` and `openspec/AGENTS.md` both returned ENOENT; `docs/architecture.md` also ENOENT. `knip.json`'s `project` globs cover only `src`, `extensions`, `pi-web-plugins`.
    **Sources:** failed reads of those three paths; `knip.json`.
    **Support:** direct evidence (of absence at those paths only).
    **Confidence:** medium — **UNVERIFIED** whether openspec lives elsewhere (e.g. `openspec/specs/`, `openspec/changes/`, or outside the repo). I had no directory listing, so this is *not* a claim that openspec is unused.

### B. Structural patterns — what to adopt, and the trade-off each buys

11. **Recommendation: enforce the process boundary with ESLint `no-restricted-imports` zones first; add dependency-cruiser only if cycles become the problem.**
    **Trade-off:** ESLint zones cost **zero new dependencies**, run inside the existing `npm run lint` (already in `verify`, already in CI on two OSes), and fail on the exact rule `AGENTS.md` states. They **cannot** detect import cycles or orphan modules, because each file is linted in isolation. dependency-cruiser detects cycles/orphans and emits a graph, but adds a dependency, a config file, and a second CI step to keep green.
    **Failure mode prevented:** finding #2 — a `web/`→`daemon/` import shipping green.
    **Maps onto:** `eslint.config.js`, adding a block for `files: ["src/server/web/**"]` forbidding `../daemon/*` patterns and the mirror block for `src/server/daemon/**`. Third block: `src/client/**` must not import `src/server/**` (today only `src/shared/**` crossings appear, e.g. `PiWebApp.ts` importing `../../../shared/apiTypes`, `../../shared/capabilities` — those are legitimate).
    **Sources (external, UNVERIFIED-IN-RUN):** ESLint `no-restricted-imports` rule docs <https://eslint.org/docs/latest/rules/no-restricted-imports>; `eslint-plugin-boundaries` <https://github.com/javierbrea/eslint-plugin-boundaries>; dependency-cruiser <https://github.com/sverweij/dependency-cruiser>.
    **Confidence:** high in the trade-off shape, medium on rule-syntax details I could not re-read.

12. **Recommendation: do NOT split into npm workspaces / separate packages.**
    **Trade-off:** package boundaries are the only *truly* unbypassable boundary (you cannot import what is not a dependency), and this repo is already halfway there — `package.json` `exports` publishes `./plugin-api` and `./server-plugin-api`, `tsconfig.plugin-api.json` builds them, and `build:plugin-api-package` even emits into `packages/pi-web-plugin-api/dist`. But the dev loop is `tsx watch` on two entry points plus one Vite build over a **single** tsconfig; workspaces would multiply build orchestration, break the `dev`/`dev:web`/`dev:client` triple, and complicate the systemd two-service setup described in `AGENTS.md`. The published plugin API already gives the one boundary that must not be violated, and it is versioned.
    **Failure mode prevented (by declining):** a build-graph refactor that costs weeks and buys enforcement that a 20-line lint block buys today.
    **Maps onto:** `package.json` (`exports`, `typesVersions`, `build:plugin-api*`), `tsconfig.plugin-api.json`, `vitest.config.ts` alias block (which explicitly mirrors tsconfig `paths` so plugin sources resolve to source, not dist).
    **Support:** direct evidence for the repo facts; the recommendation is researcher inference.
    **Confidence:** medium-high.

13. **Recommendation: feature-slice the client *incrementally*, for new work only; never big-bang.**
    **Trade-off:** feature slicing (`src/client/src/features/sessionActivity/{unread,pins,polling,waiting}.ts`) makes "who owns this behavior" answerable from the tree and gives the god component a smaller import surface. The cost is churn: a mass move rewrites ~40 import paths across `PiWebApp.ts`, `ChatView.ts`, and every colocated test, which collides directly with the owner's "one coherent change per commit" and "stage exact files" rules and makes review meaningless. The proportionality rule in `code-quality-architecture/SKILL.md` ("Avoid unrelated refactoring, opportunistic cleanup, and broad rewrites") forbids the big-bang version outright.
    **Concrete rule that respects both:** new features get a folder from day one; existing flat modules move **only** when a change already touches them, and the move is its own commit.
    **Sources (external, UNVERIFIED-IN-RUN):** Feature-Sliced Design <https://feature-sliced.design/>.
    **Confidence:** medium (the trade-off is well-grounded in this repo's own rules; the external methodology is unfetched).

14. **Recommendation: add a *ratchet*, not a cap, on the four accumulation files.**
    **Trade-off:** an ESLint `max-lines` cap produces arbitrary splits (a 900-line file cut into two 450-line halves that must be read together is worse than one 900-line file). A ratchet — "these named files may not grow" — targets the actual invariant. Simplest honest implementation: a small `scripts/` check that reads the current line counts of the four named files from a checked-in baseline and fails when any exceeds it, wired into `verify`. Any real extraction lowers the baseline in the same commit.
    **Failure mode prevented:** finding #5 — the god component being the default home for every new feature, forever.
    **Maps onto:** `package.json` `verify` chain (already `typecheck && lint && knip && test`), `.github/workflows/ci.yml` (already runs `verify`, so no workflow edit needed).
    **Support:** researcher inference. **Confidence:** medium. **Cost to name:** one more thing that can go red for a non-bug reason; the owner should decide whether that annoyance is worth the guard.

### C. Making state machines the norm, not the exception

15. **Claim (strong existing base):** `eslint.config.js` already sets `@typescript-eslint/switch-exhaustiveness-check: error`, `no-unnecessary-condition: error`, `strict-boolean-expressions: error`, and `consistent-type-assertions: ["error", { assertionStyle: "never" }]` — that last one is unusually strict and is what makes exhaustiveness meaningful, because a missing case cannot be papered over with `as`. `tsconfig.json` adds `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `allowUnreachableCode: false`.
    **Sources:** `eslint.config.js`, `tsconfig.json`.
    **Support:** direct evidence. **Confidence:** high.

16. **Recommendation: prefer `Record<State, Handler>` lookup tables over `switch` for classifier dispatch.**
    **Trade-off:** `switch-exhaustiveness-check` is an **ESLint** error — it needs the lint pass, and it only guards `switch`. A table typed `const table: Record<State, Outcome> = {…}` makes a missing state a **`tsc` error**, which fires in editors, in `typecheck`, in `typecheck:cached`, and in both CI matrix legs. It also matches the owner's own words: "lookup tables over switch ladders". The cost: tables evaluate eagerly and read worse when arms need very different parameters; those cases stay `switch` and rely on the lint rule.
    **Failure mode prevented:** a new state added to a union while one of several dispatch sites keeps compiling and silently falls to a default.
    **Maps onto:** the existing classifier family — `composerCollapseTransition` / `shouldReleaseComposerCollapse` (`src/client/src/composerCollapse.ts`), `bannerHoldDecision` (`src/client/src/bannerHold.ts`), `shouldPollSessionActivity` (`src/client/src/sessionActivityPolling.ts`), `reloadOffer` (`src/client/src/versionSkew.ts`), `workspaceDeletion.ts`'s predicate cluster, plus server-side `drainActiveWork`'s `decision.reason` union, which `sessiond.ts` today consumes with an `if / else if` chain that handles `"deadline-reached"`, `"waiting-for-active-work"`, `"no-active-work"` — **and silently does nothing for any fourth reason**.
    **Sources:** the files named (read directly).
    **Support:** direct evidence for the code shapes; the recommendation is researcher inference.
    **Confidence:** high.

17. **Observation (a genuine style gap, not a violation):** the existing classifiers I read return **booleans and small records**, not named states. `composerCollapseTransition` returns `{ collapsed, held }`; `shouldReleaseComposerCollapse` returns `boolean`. `AGENTS.md` asks for "states named in one pure classifier". A boolean is a two-state machine with unnamed states, so "why is it collapsed" is not answerable from the return value — the docstring carries it instead (and those docstrings are excellent).
    **Recommendation:** for classifiers whose *reason* matters to a caller or a test, return a discriminated union (`{ kind: "held-for-pointer" } | { kind: "collapsed-for-dialog-focus" } | { kind: "released-host-gone" }`) rather than a bool. **Trade-off:** more types and more test names for behavior a boolean already encodes; only worth it when a second caller or a bug report asks "why". Do not convert every predicate — that is ceremony without ownership clarity, which `code-quality-architecture/SKILL.md` names as the thing to avoid.
    **Support:** direct evidence for the shapes; interpretation for the gap.
    **Confidence:** medium.

18. **Recommendation: enumerate states from a single exported `ALL_STATES` tuple that the test iterates.**
    **Trade-off:** `AGENTS.md` requires "tests enumerate every state so an unhandled one fails in CI". A test that lists cases by hand drifts when a state is added. Exporting `const ALL_X_STATES = [...] as const satisfies readonly XState[]` and having the test do `it.each(ALL_X_STATES)` makes the enumeration a **single** thing to update, and combined with the `Record<State, …>` table means adding a state fails at `tsc` (table) *and* produces a failing/pending case (test). Cost: one extra export per classifier, and a slightly indirect test.
    **Maps onto:** every `*.test.ts` colocated next to the classifiers above; `vitest.config.ts` already includes them.
    **Sources (external, UNVERIFIED-IN-RUN):** TypeScript exhaustiveness via `never` <https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking>; typescript-eslint rule <https://typescript-eslint.io/rules/switch-exhaustiveness-check/>.
    **Confidence:** medium-high.

### D. Documentation as contract, and keeping it from rotting

19. **Claim:** This repo's rationale currently lives in **three** places with different rot profiles: (a) `AGENTS.md` — standing rules + incident history, actively maintained; (b) **docstrings carrying incidents**, which are the strongest artifact here (`sessiond.ts`'s "pid 5602 killed mid-turn on 2026-09-04" note explaining why `unhandledRejection` is survived but `uncaughtException` is not; `web/app.ts`'s SPA-404 note explaining why hashed assets must 404; `composerCollapse.ts`'s "点了两遍" pointer note); (c) `docs/*.html` + `docs/*.md` shipped in `package.json` `files`.
    **Sources:** `src/server/sessiond.ts`, `src/server/web/app.ts`, `src/client/src/composerCollapse.ts`, `AGENTS.md`, `package.json`.
    **Support:** direct evidence. **Confidence:** high.

20. **Recommendation: add ADRs only for decisions that are (i) irreversible or expensive to reverse and (ii) not already explained by a docstring at the site.**
    **Trade-off:** ADRs are the standard answer to "why is it like this", and they survive the code being deleted — which docstrings do not. But this repo's docstring-with-incident practice is *better* than most ADR sets, because it is co-located and therefore read at the moment of change. Adding a parallel `docs/decisions/` for things already explained in a docstring creates **two** places to rot and invites contradiction. The decisions that genuinely need an ADR are the ones with **no single code site**: the two-process ownership split, the `web`/`daemon`/`shared` rule, the plugin `runs: "web" | "both"` contract, the dual-prefix `/api` + `/api/machines/local` mounting law, and the URL-resolution convention in `AGENTS.md`.
    **Failure mode prevented:** a future contributor "simplifying" the two-process split because the reason lives only in a rules file that reads like style guidance.
    **Anti-rot mechanisms that actually work here:** (1) reference the ADR id from the docstring at the enforcing site (`serverPluginRouteMount.ts`, `sessiondStateOwnership.ts`) so a reader arriving at the code finds the decision; (2) the **existing** changeset rule already forces a user-visible change to carry a note in the same commit — extend that habit to "boundary-changing commits carry an ADR status change"; (3) the lint boundary from #11 turns one ADR into an executable check, which is the only documentation that cannot rot.
    **Sources (external, UNVERIFIED-IN-RUN):** Nygard's original ADR post <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>; MADR <https://adr.github.io/madr/>; ADR index <https://adr.github.io/>.
    **Support:** repo facts direct; recommendation is researcher inference. **Confidence:** medium.

21. **Spec-driven development / openspec:** I could not verify openspec is present (finding #10), so I make **no** recommendation about changing that workflow. **Missing evidence, flagged.** The general point that survives regardless: a spec is only a contract if something fails when code and spec diverge. In this repo the mechanisms that already do that are `knip` (dead exports), `pack:dry` (published surface), the `smoke:package-install` job, and the type-checked plugin API — all in `verify`/CI. A spec file with no such coupling is documentation, not a contract, and should be judged as documentation.

## Concrete refactor candidates

Ordered by (value ÷ risk). Each names the smallest cut, not a rewrite.

**R1 — `src/server/web/app.ts`: replace the hand-written dual-prefix mounting with one table.** *(smallest cut, highest certainty)*
Hard to change because adding a route family means remembering two call sites, and nothing detects the miss. Smallest cut: `const API_PREFIXES = ["/api", "/api/machines/local"] as const;` and a `for (const prefix of API_PREFIXES)` loop over an array of registrar closures. ~20 lines net, no behavior change, unit-testable by asserting both prefixes are registered. **Trade-off:** slightly less greppable per-route; buy that back by keeping the registrar names in the array literal. **Verified from:** the eight duplicated `register*` pairs in `app.ts`.

**R2 — `src/server/web/app.ts`: extract the inline web-plugin-runtime assembly.** The `if (webServerPluginRuntime === undefined) { … }` block (~60 lines: logger adapter, recovery config, catalog filter, four host ports, try/catch) is a distinct reason to change, sitting inside a function whose job is wiring. Smallest cut: `createWebServerPluginRuntime(deps): Promise<ServerPluginRuntime | undefined>` in `src/server/web/plugins/`, next to the existing `serverPluginRouteMount.ts`. Makes the "runtime failed to activate → contributed routes absent" path directly testable, which today requires booting Fastify. **Verified from:** `app.ts`, read in full.

**R3 — `src/client/src/components/PiWebApp.ts`: extract two feature controllers.** The precedent already exists (`AuthController`, `MachineController`, `SessionController`, `PanelResizeController`, `BrowserResumeController`, `SessionUnreadController`). Two clean candidates I read: (a) **self-update** — `selfUpdateCooldownUntil`, `refreshSelfUpdate`, `applySelfUpdate`, `skipSelfUpdate`, the `piWebSelfUpdateSkipped` localStorage key, plus the banner state; (b) **subagent/background-task activity** — `updateSubagentPolling`, `refreshSubagents` (`oneReadAtATime`), `readSubagents`, `subagentRefreshArmedFor`, and its three change-comparators. Both are self-contained, both hold their own timer/cooldown state, both currently force a `happy-dom` render of the whole app to test. **Trade-off:** more files, and a Lit `ReactiveController` is more ceremony than a method; justified here because these own state with a lifecycle. **Verified from:** lines 700–849.

**R4 — `src/client/src/appState.ts`: split the 271-line `AppState` interface into composed domain slices.** Hard to change because every field is visible to every consumer, so nothing signals which controller owns what — and `AGENTS.md`'s "data must carry the scope it belongs to" is currently upheld by **discipline and docstrings** (the `machinesLoad` / `sessionsLoad` / `projectsLoad` load-state fields are exactly that discipline, correctly done). Smallest cut: `interface AppState extends MachineSliceState, ProjectSliceState, SessionSliceState, ChatSliceState, PluginSliceState {}` — **zero runtime change, zero consumer change**, pure type reorganization, and each slice moves next to the controller that owns it. **Trade-off:** interface extension can hide field origin from a reader who does not follow the type; that is a strictly smaller problem than 271 undifferentiated fields.

**R5 — `src/shared/apiTypes.ts` (1,603 lines): split by domain.** Types-only, so the risk is close to zero and the blast radius is import statements. It is imported from both processes *and* the client (`PiWebApp.ts` imports `PiWebFleetReport`, `PiWebFleetRunResponse` from `../../../shared/apiTypes`; `sessionRoutes.ts` imports ~15 names). Smallest cut: `src/shared/api/{sessions,workspaces,plugins,fleet}.ts` with `apiTypes.ts` kept as a re-export barrel so **no consumer changes in the same commit**; consumers migrate opportunistically. **Trade-off:** a barrel can mask cycles and defeat `knip`'s dead-export detection — mitigate by deleting the barrel once consumers have moved, and by checking `knip` stays green at each step.

**R6 — `src/server/daemon/sessions/piSessionService.ts` (5,826 lines): continue its own extraction pattern.** This is the biggest file and the **highest-risk** one — it is the session owner, and `AGENTS.md` requires a manual daemon restart for changes here. Do not attempt a decomposition plan. The file already demonstrates the right move in its first five imports: `sessionActivityLabel`, `unsupportedSurface`, `hostContributions`, `warningFiling` are all previously-extracted siblings. Smallest cut: extract **one** more cohesive concern per commit, pure-first, each with its own colocated test, each verified live per the 8505 rule. Candidate ordering by likely purity: message/browser projection → queueing → unread/notification bridging → tree/fork. **Trade-off:** slow, and each commit needs a real daemon restart to verify; the alternative (a big cut) risks the one process that must not lose work. **Verified from:** the 5-line head read plus the 5,826 count.

**R7 — `src/server/sessiond.ts`: extract `createSessionDaemon(env)` so the entry file is a caller.** Today the module *is* the program: top-level `await`, `process.env` mutation, ownership claim. Smallest cut: keep the exact ordering, move it into one exported async factory taking `env` and a logger, leaving `sessiond.ts` as a ~5-line invoker like `index.ts` already is. **Trade-off:** the ordering comments must move with the code and stay adjacent to the statements they explain — if that cannot be preserved cleanly, **do not do this one**; the ordering is worth more than the testability. **Verified from:** `sessiond.ts` read in full; `index.ts` is the 7-line precedent.

**R8 — `src/client/src/components/ChatView.ts` (2,389 lines): extract pure section seams.** `testing-guide/SKILL.md` already names `chatQueuedMessageSections` as the pattern and ranks the pure seam above the DOM harness. Smallest cut: each time the file is touched, lift the content/ordering decision the change concerns into an exported pure function with its own test. This is explicitly the guide's own "convert opportunistically when the file is touched; do not run a big-bang migration" instruction, applied to production code.

## Contradictions

- **Import-time side effects.** `code-quality-architecture/SKILL.md` says "Avoid work at import time"; `src/server/sessiond.ts` performs env mutation, Fastify construction, and a top-level `await` ownership claim at module load. Both are defensible — the docstrings explain that the ordering is a correctness requirement — but the rule and the code disagree, and I am recording it rather than resolving it. R7 is the reconciling option; declining R7 is also a legitimate answer.
- **"No inline comments" vs. observed density.** `AGENTS.md` bans comments that narrate the next line; `app.ts`, `sessiond.ts`, and `PiWebApp.ts` carry many multi-line comments *inside* function bodies. Reading them, they are rationale ("why the SPA fallback must 404 for assets", "why the drain deadline is shorter than TimeoutStopSec"), which the rule explicitly permits ("Docstrings … are welcome when they carry the 'why'"). **My reading: not a violation** — but the *placement* is mid-function rather than on a declaration, so a strict reader could call it one. Flagging so the owner can settle it, not settling it myself.
- **Playwright rule vs. CI.** The owner's verification workflow mandates live Playwright verification per change wave; CI runs no e2e (finding #9). Not a contradiction in intent, but the rule has no machine backstop, so a wave that skips it leaves no trace.

## Missing evidence

- **No directory listing was possible.** Everything about the tree is inferred from import graphs. Modules that nothing I read imports are invisible to this brief. In particular I have **no** evidence about the contents of `pi-web-plugins/*` (beyond `knip.json`'s entry globs `pi-web-plugins/**/pi-web-plugin.ts` and `**/server-plugin.ts`), `src/client/src/plugins/`, `src/server/daemon/workspaces/`, or `docs/`.
- **openspec:** presence, location, and usage all UNVERIFIED (finding #10).
- **`revisionVerdict`, `replayDecision`, `bottomAnchorAction`, `promptDeliveryBehavior`** — the four classifiers `AGENTS.md` names as exemplars. I probed `src/client/src/revisionVerdict.ts` (ENOENT) and could not search. My characterization of the classifier style (#17) comes from `composerCollapse.ts` and `appShellController.ts` only, and may not represent those four.
- **Every external citation is unfetched** (see tooling disclosure). No claim in this brief depends on an external source being accurate; the external URLs support *technique choices*, and the trade-offs I state for them are derived from this repo's own constraints.
- **Actual cycle/orphan state of the module graph is unknown** — that is exactly what dependency-cruiser would answer and what I could not.
- **Line counts are a proxy for complexity, not a measure of it.** I did not read `piSessionService.ts` or `ChatView.ts` in bulk; their internal cohesion is unassessed. R6/R8 are deliberately framed as "continue the existing pattern" rather than "split into X" for that reason.

## Sources

**Kept — repository (direct evidence, read in this run):**
- `AGENTS.md` — the binding constraints; process split, classifier rule, git/verification etiquette.
- `.agents/skills/code-quality-architecture/SKILL.md` — proportionality, containment, DI, testability; the "no broad rewrites" rule that bounds every recommendation here.
- `.agents/skills/testing-guide/SKILL.md` — pure-seam-first ranking; the precedent for R8.
- `package.json` — verify chain, dual entry points, published plugin-API surface, e2e scripts.
- `eslint.config.js` — proves exhaustiveness/strictness base and the absence of boundary rules (#2, #15).
- `tsconfig.json` / `vitest.config.ts` — single project, no references, per-file DOM opt-in, alias mirroring.
- `.github/workflows/ci.yml` — what actually gates merge (#2, #9).
- `knip.json` — entry points and project scope.
- `src/server/index.ts`, `src/server/sessiond.ts`, `src/server/web/app.ts` — the two process graphs; R1, R2, R7.
- `src/client/src/components/PiWebApp.ts` (imports + lines 700–849), `src/client/src/appState.ts`, `src/client/src/composerCollapse.ts`, `src/client/src/appShell/appShellController.ts` — R3, R4, findings #3/#5/#17.
- Head reads for size: `src/server/daemon/sessions/piSessionService.ts`, `.../sessionRoutes.ts`, `src/client/src/components/ChatView.ts`, `src/shared/apiTypes.ts`.

**Kept — external (UNVERIFIED-IN-RUN; canonical URLs, not fetched):**
- ESLint `no-restricted-imports` <https://eslint.org/docs/latest/rules/no-restricted-imports> — the zero-dependency boundary guard in #11.
- dependency-cruiser <https://github.com/sverweij/dependency-cruiser> — cycle/orphan detection, the graduation path in #11.
- eslint-plugin-boundaries <https://github.com/javierbrea/eslint-plugin-boundaries> — the middle option in #11.
- typescript-eslint `switch-exhaustiveness-check` <https://typescript-eslint.io/rules/switch-exhaustiveness-check/> — already enabled here; #16 argues the table beats it.
- TypeScript exhaustiveness checking <https://www.typescriptlang.org/docs/handbook/2/narrowing.html#exhaustiveness-checking> — the `never` idiom behind #18.
- ADR: Nygard <https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions>, MADR <https://adr.github.io/madr/>, index <https://adr.github.io/> — #20.
- Feature-Sliced Design <https://feature-sliced.design/> — #13.
- Lit reactive controllers <https://lit.dev/docs/composition/controllers/> — the pattern R3 extends; this repo already implements it in `appShellController.ts`.

**Rejected / deprioritized:**
- Generic "clean architecture in Node" and "how to structure a Lit app" listicles — not fetched, and they would add no constraint this repo's own `AGENTS.md` does not already state more precisely.
- Monorepo tooling (Nx/Turborepo) comparisons — declined at #12 before evaluation; a single-package two-process app with one Vite build does not have the problem those tools solve.

## Next steps

1. **Highest value, unblocks everything else:** run a real directory listing + `madge`/dependency-cruiser pass to answer the two questions I could not — are there `web/`↔`daemon/` violations today, and are there import cycles? Everything in section B is a recommendation made *without* that data.
2. Locate the four exemplar classifiers (`revisionVerdict`, `replayDecision`, `bottomAnchorAction`, `promptDeliveryBehavior`) and read them before adopting #16/#17 — if they already return discriminated unions, #17 is a non-finding and should be dropped.
3. Confirm whether openspec is in this repo and how it is wired; #21 is deliberately empty until then.
4. Owner decisions needed before any of this becomes work: (a) lint zones now or dependency-cruiser now; (b) accept or reject the growth ratchet in #14; (c) rule on the mid-function-comment question in Contradictions; (d) whether R7 is worth touching the daemon entry point at all.
