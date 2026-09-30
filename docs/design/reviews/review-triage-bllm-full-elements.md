# bllm full-element review triage — 2026-09-06

Three anonymous lanes (botim-bllm/glm-5.3-flash:max ×2 with split focus,
botim-bllm/qwen3.8-flash-next:max full pass) reviewed every element surface on
desktop and phone at HEAD 2d475388. Findings deduplicated across lanes; every
suspicion below arrives pre-adjudicated by its lane and was re-verified here
before triage. Artifacts: /tmp/lane1-phone-shell.md, /tmp/lane2-chat-dialogs.md,
/tmp/lane3-full-pass.md (session subagent-artifacts, run 29bb1697).

## P1 — fixed this wave

1. **Back presses swallowed after closing settings** (lane1 F1 = lane3, two
   lanes independently). `closeSettings` pushes a clean URL; the stale
   `?settings…` frames below are invisible to `currentRouteMatchesUrl()`, so
   popstate early-returns and the gestures die. Fix: gate the early return on
   settings parity (`settingsOpen === readSettingsOpen()`), making a settings
   frame a meaningful back target that reopens the sheet — URL-driven-layer
   semantics, one owner for the URL⇔dialog invariant.
2. **"‹ Settings" exits settings on deep-link/plugin entry** (lane1 F2 = lane2
   = lane3, three lanes). `history.length > 1` is a proxy; a deep link or
   `openSettings(section)` puts a section frame on an app frame and back pops
   out of the sheet. Fix: track whether the list frame was actually written
   (`settingsListFramePushed`), pop only then, else the replace-to-root
   fallback.
3. **Landscape hybrid shell** (lane2). The JS predicate moved to
   coarse-or-mobile but the paired CSS in PiWebApp (`.mobile-navigation-panel`,
   `main.navigation-view .empty`, `aside`) stayed width-only — landscape
   phones rendered the panel above the chat and kept the aside column. Fix:
   re-scope those rules to the same compound query.
4. **Settings sheet on landscape phones** (lane1 F3). SettingsDialog's
   `phoneQuery` and its full-bleed CSS block still width-only. Fix: same
   compound query for both.
5. **Orphaned CSS block in PromptEditor** (lane2). Lines 170-175 lost their
   `@media` opener and ship an unbalanced brace; desktop composer spacing and
   model-button width are wrong at every width. Fix: recover the original
   opener from history.
6. **Composer attachments survive a session switch** (lane2). Attachments are
   the one composer state not swapped per session — session B inherits
   session A's image chips, violating the scope rule the pending-prompts strip
   already follows. Fix: clear them in the existing session/machine change
   branch.

## P2 — fixed this wave (small, same surfaces)

7. Settings URL writes inherit the 400 ms route coalescer (lane1 F7 = lane2 =
   lane3): a fast gesture pair replaces the list frame. Fix: settings route
   writes force push.
8. Context-bar panel toggle lies in the remapped state (lane1 F4): derive
   `shellPanelOpen`/toggle from the same display-view helper render uses.
9. Compact scope chip dead tap when its target is the fallback-visible section
   (lane1 F6): expand instead of toggle there.
10. Empty-string panel badges render a zero-width pill on the phone (lane1
    F8); `.tool-badge` has no overflow cap (lane1 F9); scope chip lacks
    `dir="auto"` (lane1 F10).
11. Sessions heading claims "0" while unloaded/loading (lane2): render the
    count only when loaded.
12. Settings a11y: hosts select/textarea unnamed; sessiond ask-user toggle
    aria-label mismatches its visible label (lane2).
13. Touch floors under 44px with no coarse raise: `.command-dismiss`,
    `.queued-clear-button`, `.image-zoom-close`, `.history-load-button`,
    `.subtree-toggle` (lane2).
14. Desktop keyboard focus into Machines targets a compact-only switcher
    (lane1 F5): focus the machine list in both modes.

## Fixed separately

15. `.changeset/clay-default-and-phone-settings.md` declares minor — owner
    rule forbids minor (rolls the fake CalVer month). Changed to patch in its
    own commit.

## Judged not true / not fixed with reason

- **Machines panel heading style divergence** (lane2, design-ambiguous): the
  card grid panel uses the display font deliberately; left for the owner to
  rule on during the design pass (task-3 design standard).
- **Tool view survives workspace loss on phone** (lane3 P3, report-only):
  test-backed `workspaceViewTransition` choice; if the owner wants the picker
  there too it belongs to the next design wave, not a silent change.
- **appState stale goals docstring** (lane3 P3): fixed as a doc correction,
  not a behavior finding.

## Clean (lanes' one-line verdicts, spot-checked)

navigationState classifiers; historyWrites placeholder lifecycle;
settingsRoute parsing/aliases; SettingsDialog phoneQuery lifecycle; tools-grid
selected state and icon fallback; ChatView three-stated claims; SessionList
load discipline and tree edges; sessionSearch; AskUserCard/ExtensionDialogCard
contracts; ModalSurface escape/backdrop/focus; attachment capture pipeline;
theme fallback; registry route aliases; machine/workspace scope clearing.
