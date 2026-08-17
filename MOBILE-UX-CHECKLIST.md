# Mobile UX checklist

Every item the user raised, with the evidence required to tick it. An item is
ticked only when a test asserts the user-visible outcome — the accordion bug
below shipped green because its test asserted an internal flag instead.

Verified against the isolated Docker dev stack (`npm run docker:verify:start`,
tailnet `:8506`), never the host installation.

## Done

- [x] **Collapsed sections actually collapse.** `:host([hidden])` was missing, so
      a "hidden" list kept its full height and pushed the workspace list off
      screen after choosing a project.
      *Evidence:* `e2e/mobile.spec.ts` measures height/top, not the attribute.
- [x] **Session name leads the context bar** on the chat surface, with the
      location trail collapsed to one breadcrumb. *Evidence:* `AppContextBar.sessionLed.test.ts`.
- [x] **Session rename / aliases**, reusing the daemon's `/name` command so
      persistence and broadcast keep one owner. *Evidence:* `sessionController.rename.test.ts`.
- [x] **Work indicator correctness.** Added a status catalog plus hydration on
      load and on realtime reconnect; live events stay authoritative.
      *Evidence:* `sessionController.statusHydration.test.ts`, `sessionRoutes.test.ts`.
- [x] **Goals are native.** Multi-goal panel with task tree, progress, current
      task, and verification contracts, read from `.pi/goals/`.
      *Evidence:* `goalFile.test.ts`, `GoalPanel.test.ts`, `e2e/mobile.spec.ts`.
- [x] **Model search by remembered fragments** (`opus-5 work`), with abbreviation
      matching that refuses scattered mid-word letters. *Evidence:* `fuzzyMatch.test.ts`,
      `CommandPicker.test.ts`, `promptCompletions.test.ts`.
- [x] **Transient errors de-emphasised** (`sessiond.sock ENOENT`, aborted requests).
      *Evidence:* `errorBanner.test.ts`.
- [x] **Re-asked background prompts stop piling up.** An ignored, timed-out
      background prompt leaves no transcript card; a dismissal still does.
      *Evidence:* `sessionController.backgroundDialogs.test.ts`.
- [x] **Long dialog text stays readable** — heading plus scrollable detail body
      that preserves newlines. *Evidence:* `ExtensionDialogCard.test.ts`.
- [x] **Prompt history** (up/down recall, Ctrl-R search). *Evidence:* `promptHistory.test.ts`.

## Open — layout and interaction

- [ ] **Audit every surface against the Web Interface Guidelines skill**
      (`~/.agents/skills/web-design-guidelines`). Known findings to resolve:
  - [ ] List rows are `<div tabindex="0">` with click handlers; the guidelines
        call for real `<button>`s (`SessionList.ts:339`, `WorkspaceList.ts:85`).
        Also the reason e2e has to click `.action-main` instead of a role.
  - [ ] Confirm `touch-action: manipulation` covers every tap target, not just
        the five current call sites.
- [ ] **Top bar density**: still two rows (context chips + icon tab strip) before
      the list begins. Measure and reduce.
- [ ] **Long project lists** need search/virtualisation: 10+ projects already
      fill the viewport.
- [ ] **Keyboard avoidance**: verify the send control stays reachable with the
      soft keyboard open, on a real device rather than only in a headless
      viewport.
- [ ] **Attachments above the input**, no delivery dropdown, correct caret size —
      re-verify on device after the layout changes above.

## Open — cross-device and attention

- [ ] **One place that answers "where do I need to act?"** across machines and
      workspaces, ranked: `ask_user` waiting > run failed > finished/idle with
      unread > running > recent.
- [ ] **Cross-device session continuity**: open the same session from another
      device and land on the same scroll position and draft.
- [ ] **Attention surface for finished work**: an agent that went idle after a
      long run should be discoverable without hunting through workspaces.
- [ ] Decide whether this is a new top-level view or an extension of the quick
      switcher; the quick switcher already carries the ranking primitives.

## Open — voice input

- [ ] **Tap-to-talk in the composer**: one tap starts capture, one tap stops.
- [ ] **VAD**: keep recording while silent, transcribe once speech is detected
      and finished; do not cut off a slow start.
- [ ] **STT**: choose the engine and where it runs. Decision needed — browser
      `SpeechRecognition` is free and instant but Chrome-only and sends audio to
      Google; a server-side Whisper keeps audio local but needs a model and CPU
      budget on this box.
- [ ] Transcribed text lands in the composer as editable text, never auto-sent.
- [ ] Permission, offline, and no-speech states are visible rather than silent.

## Method

- [ ] Run the Playwright suite after every change, not at the end
      (`npm run e2e:mobile`).
- [ ] For each fix, first write the assertion that fails for the reported reason.
      The accordion bug is the cautionary case: the test asserted
      `hasAttribute("hidden")`, which was true the whole time.
