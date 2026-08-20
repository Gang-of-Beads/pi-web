# Acceptance review

The redesign was accepted against ten criteria. This is the point-by-point
comparison: what each one asked for, where the behaviour lives now, and what
proves it. Every claim here names a file, a test, or a command whose output can
be re-read; nothing is asserted from memory.

Reviewed at `main` after the merge of `redesign/ia-and-multi-machine` (PR #1,
squashed as `53006c1`).

---

## 1. IM-style delivery states

**Asked for:** sending → received (one mark) → queued (naming steer vs
follow-up) → in-turn (two marks) → failed ("not sent", text recoverable); and
one message must stop appearing in both the bubble and Queued messages.

**Where it lives:** `src/client/src/messageDelivery.ts` holds the state machine;
`ChatView.ts:112` renders the corner mark; the browser mints the id in
`sessionController.deliverPromptToSession` and the server carries it back.

- The states are exactly the five asked for, and `queued` carries its lane:
  `queuedIds: Map<string, "steer" | "followUp">`.
- The machine never moves backwards, so a late status cannot pull a delivered
  message back to queued.
- Failure keeps the text: the bubble stays, marked "Not sent", and
  `ChatView.resendMessage` puts it back.
- The duplicate is fixed at the source: the server marks its own echo, and the
  agent's committed copy replaces it, which also covers a second device and a
  reloaded tab (where the browser has no id to match on).
- A retry of one request is told from a deliberate repeat by its id, so sending
  "continue" twice on purpose still sends twice.

**Proof:** 19 unit tests in `messageDelivery.test.ts`, 5 end-to-end tests in
`e2e/messageDelivery.spec.ts` run against the live daemon.

## 2. Context-bar navigation

**Asked for:** machine/project/workspace collapse into one context row; the
panel body belongs to sessions; 33 sessions browse, search and operate; goals
stop squeezing the session area.

**Where it lives:** `appShell/AppContextSwitcher.ts` (the row),
`AppNavigationPanel.ts` (one body at a time).

Four stacked scrolling lists became one row plus one body. Choosing a step opens
that picker in the body and returns to sessions on selection. Desktop and phone
share the model, which retired the second navigation implementation entirely.

**Proof:** `AppContextSwitcher.test.ts`, `AppNavigationPanel.test.ts`,
`e2e/navigationLayout.spec.ts`, and container screenshots on the
`e2e-fixture-layout` project (12 seeded sessions).

## 3. Inline create and row menus

**Asked for:** create machine/project/workspace/session from a `+` beside the
section, not through Actions; hold (touch) and right-click (mouse) open row
menus; no capability lost.

**Where it lives:** `AppContextSwitcher.renderStep` carries the `+` for machine
and project; the session list header keeps its own. `rowMenuGestures.ts` wraps
`LongPressTracker` and `contextmenu`.

**Workspace has no `+` on purpose:** the server has no create-workspace
endpoint - workspaces come from a provider - so no button is offered that could
not work. Recorded in `docs/feature-map.md` rather than left as a silent gap.

**Long-press means two things, deliberately:** on picker rows it opens the row
menu; on session rows it keeps the multi-select it has always had. Locked by an
e2e test each.

**Proof:** `rowMenuGestures` tests, `e2e/mobile.spec.ts` hold tests,
`docs/feature-map.md` (36 rows) mapping every capability old entry → new entry.

## 4. Archiving a stuck goal

**Asked for:** archive/clear a stuck goal from the web UI without racing
pi-goal-x's ledger and lock.

**Where it lives:** `src/server/goals/goalArchive.ts` performs the extension's
own seven-step protocol - take its lock briefly, append to its ledger,
invalidate its snapshot, preserve the prose body - and
`workspaceExplorerRoutes.ts:52` exposes it. Lock conflicts answer 409.

`/goal-clear` was not an option: the container has no pi-goal-x, and a web
session has no `ctx.hasUI`, so the command refuses. The file protocol is the
integration surface that actually exists.

The panel confirms in two presses and warns when a running agent may recreate
the goal, because that is a real outcome the user should not discover later.

**Proof:** 13 unit tests in `goalArchive.test.ts`, 3 in `e2e/goalArchive.spec.ts`
(including the locked case), and a container run observed the revision advance
12 → 13 with the file landing in `archived/`.

## 5. `/pi-web` as one multi-level command, with hub semantics

**Asked for:** `restart|update|status|machines [--all|--machine=…]`, where
`--all` fans out from the machine the browser is connected to, and the output
says which machine it fanned out from, which it covered, and each result and
version. Plus a fleet API and fleet UI.

**Where it lives:** `extensions/pi-web.ts` parses the subcommands and flags;
`src/server/updates/fleetRoutes.ts` owns the fan-out
(`GET /api/pi-web/fleet`, `POST /api/pi-web/fleet/run`) and every report names
its hub; `settings/SettingsFleetSection.ts` is the UI.

The fan-out is the server's, not the browser's: pi-web is hub-and-spoke, the
browser only talks to the machine that served it, and remote machines are
reached through `machines/machineProxyRoutes.ts`. Doing it anywhere else would
have meant a different answer depending on which session happened to be selected
- the exact ambiguity this replaced.

Where restart is genuinely unavailable - a container with no service manager -
it says so rather than reporting success.

**Proof:** 8 tests in `fleetRoutes.test.ts`, 5 in `SettingsFleetSection.test.ts`,
and the live host returns both of its real machines through the endpoint.

## 6. A phone that can be used daily

**Asked for:** top chrome that does not eat the chat, back gesture, long-press
menus, keyboard avoidance, one-handed reach, usable lists, locked by Playwright.

**What changed:** a strip of eight unlabelled icon buttons became
`AppMobileToolSheet`, which lists every view by name. Content starts at 105px
instead of 191px. The transcript takes 76% of a 390×844 screen, with the
composer and send button in the thumb zone.

No gesture the platform already owns is bound: no edge-back, no long-press over
selectable text, no pull-to-refresh, no double-tap zoom. Written down in
`docs/mobile-gestures.md` with the reason for each.

**Proof:** 20 passing mobile Playwright tests, including chrome height, keyboard
inset, thumb reach, and the two long-press meanings.

## 7. Themes as a first-class feature

**Asked for:** visible entry, live preview, follow-the-system switch, more
themes, plugin-contributed themes still work.

**Where it lives:** `settings/SettingsAppearancePanel.ts` - swatch previews of
the actual colours, a follow-system switch, and an "in use" marker - reachable
from the settings gear and by `?settings=appearance|theme|themes`. Six themes
now: pi-web-dark, pi-web-light, classic, high-contrast, night, paper. The
plugin contribution point (`plugins/types.ts:51 themes?: ThemeContribution[]`)
is untouched.

**Proof:** 6 tests in `SettingsAppearancePanel.test.ts`, registry assertions on
the theme list, and a container run switching to Night and surviving a reload.

## 8. The visual round

**Asked for:** a palette and type pairing of its own, unified density, radii,
hierarchy and state colours, components repainted, interaction contracts intact.

**What it is:** a scale layer separate from colour - `--pi-space-1..9`,
`--pi-text-2xs..xl`, leading and weight, `--pi-radius-xs..pill`, control
heights, motion durations and easing, focus-ring width and offset, and three
font stacks named by role. Themes decide colour and nothing else, so two themes
can no longer disagree about how tall a row is.

Type stacks are named, not downloaded: this is a PWA served over a LAN address,
so a webfont would be a blank first paint or a failure offline. The pairing and
the scale carry the identity instead.

The identity is spent in one place - a coloured rail on each row's left edge,
taking its colour from the state that row already reports. Thirty sessions are
read by scanning, and an 8px dot in the far corner does not survive a scan.

**Contracts held, and one caught:** `designTokens.test.ts` asserts the scale is
published, that the five shared sheets use it, that no off-scale padding or raw
radius creeps back, that focus rings come from the focus tokens, and that every
animating sheet has a `prefers-reduced-motion` guard - which found two sheets
that animated without one. Contrast was measured across all six themes: body
text 14:1 or better, muted and state colours above 3:1.

## 9. Upstream alignment and a zero-removal inventory

**Asked for:** assess and merge what upstream is ahead by (one commit:
`0b6497b2`), write down anything declined, build a repeatable process, and prove
every original capability is still reachable with a clear entry point.

- `0b6497b2` is in, byte for byte (`git diff 0b6497b2 HEAD -- <its files>` is
  empty).
- `scripts/upstream-sync.sh` reports outstanding commits, the files they touch,
  and the ones declined with reasons in `docs/upstream-declined.tsv`. It now
  reports `outstanding: 0`.
- It survived its own first real test: the squash merge rewrote the patch id of
  everything it absorbed, so `git cherry` stopped recognising a commit the fork
  demonstrably had. The report now checks the files an upstream commit touched
  before calling it outstanding.
- `docs/feature-map.md` maps all 36 capabilities old entry → new entry. The
  last two holes closed in task-10: Terminal took `⌘3` so the view numbers name
  positions, and the resize handle states its reset gesture rather than leaving
  it as folklore beside the palette entry.

## 10. The pi-goal-x boundary

**Asked for:** a stated division of responsibility and an interaction contract -
reading, archiving, focus/pause/resume, the event stream, the lock - and it must
be implemented, with race conditions and failure modes named.

**Where it lives:** `docs/pi-goal-integration.md`: who owns what, the facts that
constrain the design (including that writes inside a turn are unchecked while
writes outside one are revision-checked), the contract pi-web follows, and the
consequences for the panel. `goalArchive.ts` is that contract in code.

The named failure modes: another process holding the lock (409, no write), an
abandoned lock (honoured for a bounded time, then taken), and an agent that is
mid-turn and may recreate the goal after the archive - warned about in the
panel, because it is a real outcome rather than a theoretical one.

---

## Gates

Run on `main` after the merge:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npm run lint` | clean |
| `npx knip` | clean |
| `npx vitest run` | 380 files, 3766 passed, 2 skipped |
| `npx playwright test` | 60 passed, 28 skipped (desktop + mobile) |
| CI | ubuntu-latest and windows-latest both green |
| bllm provider smoke | a real turn against `deepseek-v4-flash` returned the expected reply |

CI green on Windows took two fixes. One was pre-existing - `main`'s Windows job
had been failing on a test that hard-coded a POSIX path where the route resolves
it. The other was ours: the archived-goal record stored its path with the
platform separator, where the extension's own on-disk convention is POSIX. Both
were fixed at the cause rather than by relaxing the assertion.
