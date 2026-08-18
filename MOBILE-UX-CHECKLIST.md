# Mobile UX checklist

Every item the user raised, with the evidence required to tick it. An item is
ticked only when a test asserts the user-visible outcome — the accordion bug
below shipped green because its test asserted an internal flag instead.

Verified against the isolated Docker dev stack (`npm run docker:verify:start`,
tailnet `:8506`), never the host installation.

## Done

- [x] **Caret is one line tall before typing.** CodeMirror renders the
      placeholder inside the first line, and the hint wraps to three lines on a
      phone, so the empty line box — which sizes the caret — stood 67px tall and
      snapped to 22px on the first keystroke. Taking the placeholder out of flow
      fixes it. *Evidence:* measured 67px→22px in the container; e2e
      "composer > keeps the caret one line tall before anything is typed".
- [x] **Quick switcher ranks by attention, not just recency.** Groups now lead
      with waiting-for-you (daemon `pendingAsk`), then working, then
      finished-unseen. The unread set was already being passed in and ignored.
      *Evidence:* `quickSwitcher.test.ts` attention-ranking suite (5 cases).

- [x] **The update prompt stops recurring.** The checkout pinned pi 0.84.1 while
      the CLI had moved to 0.84.2, so every session opened an unsatisfiable
      "Update 0.84.1 → 0.84.2" prompt. *Evidence:* SDK aligned to 0.84.2
      (with pi-ai / pi-agent-core, or two copies of pi-ai break the types).
- [x] **One-click resend of a failed prompt, images included.** A turn that
      fails after delivery left the transcript as the only copy of what was
      sent, so retrying meant retyping the text and re-picking every image.
      *Evidence:* `resendMessage.test.ts`, `PromptEditor.restorePrompt.test.ts`.

- [x] **Archiving works for a session with no file yet.** A session with no
      messages has a path but no transcript, and the copy step raised a raw
      `ENOENT copyfile` while the delete step already tolerated the same case.
      *Evidence:* `sessionArchiveStore.test.ts` (archive + restore), plus a live
      `{"archived":true}` from the container for both an unwritten and a
      written session.

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
  - [x] **List rows now expose a real button.** All four lists (project,
        workspace, session, machine) render their primary region as
        `<button class="action-main">`; the row keeps no click handler or
        tabindex, so the actions menu stays a sibling rather than nesting one
        interactive element inside another. The session list's checkbox moved
        out of the button for the same reason — it is absolutely positioned
        against the row, so its place on screen is unchanged.
        Two things had to move with it: `activateSelectableRow` exists to ignore
        clicks bubbling from controls inside a row, and once the primary region
        became a button that guard suppressed the row's own activation, so a
        real button calls its handler directly; and `.action-main` gained font
        and cursor resets so a button does not inherit the UA's control styling.
        *Evidence:* e2e "list row semantics › exposes the project row's primary
        action as a real button" asserts the tag, that the menu is not nested,
        and that the row has no tabindex; the e2e helper now prefers
        `button.action-main`. vitest 3184 passed, e2e 20 passed.
  - [ ] Confirm `touch-action: manipulation` covers every tap target, not just
        the five current call sites.
- [ ] **Top bar density**: still two rows (context chips + icon tab strip) before
      the list begins. Measure and reduce.
- [x] **Long project lists are searchable.** The project list had no search at
      all while the session list did, and a phone shows a full screen of
      projects well before the list feels long — the verification container had
      128 of them. Filtering reuses the app's shared fuzzy rules, so `web mob`
      finds `pi-web-mobile` and behaviour matches every other search surface.
      The field appears at six projects and stays while a query is active, so
      clearing it is always possible. Search styling moved to `listStyles` as
      `.list-search*` so a second list cannot drift from the first.
      *Evidence:* `projectSearch.test.ts` (9 cases); measured in the container —
      8 projects, typing `tools` left exactly `alpha-tools` and `beta-tools`.
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
- [x] **Verify in the Docker dev stack, never the host.** The host installation
      is the user's working environment; restarting it to test a change
      terminates their session. Deploy to the container instead:
      `npm run build && ./docker/pi-web-docker --dev restart-sessiond restart-web`,
      then drive `:8511` with Playwright. Frontend edits hot-reload; server
      edits need the rebuild because the container runs `dist/`.
- [ ] For each fix, first write the assertion that fails for the reported reason.
      The accordion bug is the cautionary case: the test asserted
      `hasAttribute("hidden")`, which was true the whole time.
