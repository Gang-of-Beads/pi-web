# Every element: native or plugin?

The owner asked for a walk over every element on the page with a verdict: does
it belong in the native core, or in an extension/plugin? This inventory covers
every rendered surface, states the current home with file:line evidence, and
applies the ruled criteria. Prior owner rulings are carried forward, not
re-litigated; only genuinely open items end in the ruling questions.

## Criteria (from the pi philosophy work, already ruled)

- **Native core** = the app's identity and chrome (shell frame, resident row,
  panel), core domain the product exists for (machines axis, projects,
  workspaces, sessions, transcript host, composer host), and contract plumbing
  (modal registry, action palette host, panel host, settings host).
- **Plugin** = a domain with its own backend, its own product surface, or its
  own release cadence. Bundled today: git, info, relays, terminal, updates,
  voice, workspace-tasks. External repos: pi-web-goals (goals), pi-web-themes
  (themes). The plugin API exposes the seams: actions, workspacePanels,
  drawerSections, composerContributions, messageRenderers, settingsSections,
  workspaceLabels, themes/themePairs.
- **Carried rulings**: the machines axis stays a core method
  (`machinesLoad` state machine, `?machine=`, `/api/machines/local` dual
  mount); the status bar stays; the shell row + unified panel are done and
  probe-pinned; activity and notifications move to plugins behind the
  projection seam and `sessionBadges`/`activityDock` contribution points
  (approved, migration step ②③, not yet started).

## A. Shell chrome (always on screen)

| Element | Home | Verdict |
|---|---|---|
| Resident row (☰, session title, working indicator) | `appShell/AppContextBar.ts` | native — shell identity; feature slots pinned by `appSurface.ts` contract test |
| Unified navigation panel (header: refresh, ⚙, Actions) | `appShell/AppNavigationPanel.ts` | native — the host that renders every section and picker |
| Panel edge controls (navigation/workspace grips) | `appShell/AppPanelEdgeControl.ts` | native — shell geometry |
| App refresh control (PWA reload pill) | `appShell/AppRefreshControl.ts` | native — app lifecycle |
| Context chips (Machine/Project/Workspace + add) | `appShell/AppContextSwitcher.ts` | native — machines/projects/workspaces are core domain (ruled) |
| Error banner / stale-client banner / deprecated-inputs banner | `errorBanner.ts`, `deprecatedAgentInputsBanner.ts`, `PiWebApp.ts` | native — core delivery honesty |
| **Self-update banner** (check + apply, 60s poll) | `PiWebApp.ts:777-783` (`selfUpdateApi.status()`) | **ruling needed** — the update domain already has the updates plugin (panel + actions); the core draws a second surface into the same domain |
| Status bar (sent/received tokens, context, cost) | `StatusBar.ts` | native — owner ruled it stays |

## B. Panel sections

| Element | Home | Verdict |
|---|---|---|
| Machine list / machine switcher | `MachineList.ts`, `MachineSwitcher.ts` | native — ruled core method |
| Project list (search, add, close, trust) | `ProjectList.ts`, `ProjectDialog.ts` | native |
| Workspace list (+ plugin label items) | `WorkspaceList.ts` | native host; `workspaceLabels` is already the plugin seam |
| Session list (rows, badges, unread, rename, cleanup, start) | `SessionList.ts`, `SessionRenameDialog.ts`, `SessionCleanupDialog.ts`, `sessionRowIndicator.ts` | native; rich badges move behind `sessionBadges` when step ② lands (ruled) |
| Session tree navigator (subtree, long-press) | `SessionTreeNavigator.ts`, `rowMenuGestures.ts`, `selectableRow.ts` | native — sessions are core domain |
| Tools section (the host that lists panels) | `AppNavigationPanel.ts` `renderToolsSection` | native host |
| Files panel | core contribution `plugins/core/panels.ts` (`workspace.files`) → `WorkspaceFilesPanel.ts`, `WorkspaceFileViewer.ts`, `CodeViewer.ts`, `filesSplitLayout.ts` | **ruling offered** — core contribution today; could extract as a files plugin like git |
| Terminal / Tasks / Relays / Updates / Info panels | bundled plugins `pi-web-plugins/{terminal,workspace-tasks,relays,updates,info}` | already plugins ✓ |
| Generic panel host (slot, empty states, scroll edges) | `WorkspacePanel.ts` | native — contract plumbing |

## C. Conversation

| Element | Home | Verdict |
|---|---|---|
| Transcript host (groups, event groups, scroll anchoring, reading position) | `ChatView.ts`, `chatTranscript.ts`, `chatMessages.ts`, `readingAnchor.ts`, `bottomAnchor.ts` | native — the product's host |
| Message rendering | `ToolExecutionView.ts`, `FormattedText.ts` + `messageRenderers` seam | native host, plugin renderers already supported ✓ |
| Role headers / log voice | `ChatView.ts` `.label`, `.drawer-tab`, `.subagent-kind` | native |
| **Activity drawer content** (subagents, background tasks, their output) | `ChatView.ts` top drawer, `sessionActivityPolling.ts`, `subagentRunStatusLabel.ts` | ruled → pi-web-activity (step ②, pending); dock skeleton stays native behind `activityDock` |
| **Notifications drawer content** (per-session notifications, dismiss) | `ChatView.ts`, `sessionNotifications.ts`, `sessionWarningVisibility.ts` | ruled → pi-web-notifications (step ③, pending) |
| Activity dock (waiting/sending/turn clock/reveal) | `ChatView.ts` `.activity-dock`, `turnActiveState` | native skeleton (ruled); plugin contributions land behind `activityDock` |
| Conversation meter (progress bar) | `ConversationMeter.ts` | native — transcript chrome |
| Ask-user card | `AskUserCard.ts` | native — the `askUser` tool is a core host contract |
| Extension dialog card | `ExtensionDialogCard.ts`, `splitDialogTitle` | native host — this is the plugin dialog surface itself |
| Command ledger / command picker / model picker / thinking picker | `commandLedger.ts`, `CommandPicker.ts`, `ModelPicker.ts` | native — core routing (commands, model catalog) |
| Composer (text, attachments, slash/@/#, dictation draft, send/stop) | `PromptEditor.ts`, `composerEditorSetup.ts`, `AutocompleteMenu.ts`, `promptHistory` | native host; `composerContributions` is the plugin seam (voice uses it) ✓ |
| Jump-to-bottom, waiting cards, recall queue | `ChatView.ts`, `waitingRecall.ts`, `pendingOutbox.ts` | native |

## D. Dialogs, switchers, palettes

| Element | Home | Verdict |
|---|---|---|
| Auth dialog (oauth/api key) | `AuthDialog.ts` | native — pairing is core |
| Machine dialog | `MachineDialog.ts` | native — machines core |
| Settings dialog + sections | `SettingsDialog.ts`, `settings/*` | native host; `settingsSections` is the plugin seam ✓ |
| Quick switcher (sessions/machines, cross-project) | `QuickSwitcher.ts` | native — ruled (quick access stays core) |
| Action palette + plugin actions | `ActionPalette.ts`, `actionMenu.ts` + core/external actions | native host; actions are the plugin seam ✓ |
| Modal surface/registry, banner hold | `ModalSurface.ts`, `modalLayerRegistry.ts`, `bannerHold.ts` | native — infra |
| Theme picker | `SettingsAppearancePanel.ts`, theme picker command | native host; themes come from the pack plugin ✓ |

## E. Everything already plugin (no action)

git, info, relays, terminal (panel defined by the plugin itself,
`defineTerminalPanel.ts`), updates (panel + actions), voice (composer
contributions + speech backend), workspace-tasks (panel + actions) — bundled;
goals (pi-web-goals) and themes (pi-web-themes) — external repos. The core
keeps only their seams.

## Rulings needed

1. **Self-update banner** — first framing conflated two domains. The banner
   updates pi-web itself ("pi-web 有新版本：X → Y", 60s poll,
   `renderSelfUpdateBanner`, PiWebApp.ts:852); the updates plugin updates pi
   CLI packages. The banner is a sibling of the stale-client reload banner it
   shares CSS with — both guard the app's own lifecycle. Ruling re-asked with
   the corrected framing: (a) keep native — app self-update is lifecycle
   chrome, like the refresh pill; (b) still extract if the owner wants the
   pi-web version domain out of core too.
2. **Files panel** — **ruled: extract as a files plugin**, aligned with
   git/terminal (external repo, panel + file APIs wrapped by the plugin).
   Execution lands as its own wave; the core keeps the workspace panel seam
   and this table records the move.
3. **Self-update banner** — **ruled: extract and unify with the pi updater**
   into one update plugin (owner, 2026-09-06). Owner also reported the live
   bug that motivated it:

### The update re-prompt bug (root cause)

Reported: "每次都要点但是点了切别的 session 还有要更新". Mechanism, verified
against source:

- The in-session updater dialog is the pi-updater pi extension
  (`~/.pi/agent/git/github.com/VincentHanxiaoDu/pi-updater/index.ts`). A
  *Skip* answer settles machine-wide (`dismissVersion`/`settleExtensionSet`,
  index.ts:563-564, 590-594, 611) — the answered path is fixed.
- But closing the dialog **without choosing** resolves the extension's
  promise with the cancel value (`extensionDialogWaiters.ts:89`), and the
  updater treats cancel as "leave without recording" (`if (!choice) return;`,
  index.ts:587). That is deliberate TUI semantics — "an unanswered dialog
  returns once" (index.ts:612) — but in the web the card has a visible
  dismiss affordance, so a reader who closes the card re-prompts in the next
  session and reads it as the bug. Live cache confirms a live unresolved
  offer (`~/.pi/agent/update-cache.json`: latest 0.85.1, dismissed 0.85.0).
- Proposed settle semantics for the web surface (ruling below): any close of
  an update dialog in pi-web — dismiss included — settles machine-wide, so
  the prompt never returns for the same offer set.

**Ruled (owner, 2026-09-06)**: the dismiss-settles fix folds into the unified
update-plugin wave — no interim hotfix on the live behavior. Repo shape: the
**bundled `pi-web-plugins/updates` extends** to absorb the core self-update
banner and `selfUpdateApi`; the pi extension (pi-updater) stays a separate
package as the in-session face, same domain, shared settle state. Core keeps
nothing update-shaped once the wave lands.

### Unified update plugin (design shape)

One repo (pi-updater) carrying both faces of the domain: the pi extension
(in-session prompts, existing logic) and a pi-web browser+server plugin that
absorbs the bundled `pi-web-plugins/updates` panel and the core self-update
banner + `selfUpdateApi`. Core keeps nothing update-shaped; the plugin owns
the pi-web version channel through a designed seam. Settle state stays in the
agent-dir cache, shared by every session and surface.

Everything else in the inventory is native or already a plugin with a ruled
reason; no other element is proposed to move.
