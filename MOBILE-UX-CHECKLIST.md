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

- [x] **Motion respects `prefers-reduced-motion`.** The app honoured it
      nowhere, and the goal progress bar animated `width`, which runs on the
      layout thread. Every animation here is ornamental — progress, pulses,
      fades — so a blanket reduction is right rather than designing reduced
      variants; the bar now scales on the compositor instead.
      *Evidence:* measured in the container, `transition-duration` on a list row
      is `0s` normally and `1e-06s` under `reduce`; `GoalPanel.test.ts` asserts
      the progress *fraction* rather than a CSS unit.
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
  - [x] **Tap targets opt out of the double-tap-zoom delay.** Only five call
        sites had `touch-action`, and every control sampled in the container
        computed to `auto` — including list rows, row menus and the quick
        actions — so each tap waited for a double-tap gesture to be ruled out.
        The rule is scoped to controls and lives in the shared style blocks each
        component adopts, because a rule on the app shell does not cross a
        component's shadow boundary; `AppNavigationPanel` defines its own styles
        and needed it repeated. Gesture surfaces keep what they set for
        themselves: the terminal soft keys stay `pan-x`, the copy selector
        `auto`, the resize handle `none`.
        *Evidence:* measured before (`auto` everywhere) and after
        (`manipulation` on row button, row menu, quick action).
  - [x] **Every `outline: none` now has a focus replacement.** The guidelines
        forbid removing the outline without one, and four places had done so:
        the composer (CodeMirror suppresses its own outline, so the composer was
        the one control in the app that gave no sign of being focused), the
        action palette's input, and the option containers of the command picker
        and auth dialog — all three focusable by keyboard for arrow navigation.
        *Evidence:* measured in the container, the composer's box-shadow goes
        from `none` to `rgb(100,48,216) 0 0 0 1px` on focus. The two remaining
        cases in TerminalPanel are deliberate: xterm draws its own cursor, and
        the copy selector is a transparent proxy over it.
- [x] **Desktop: the chat no longer loses half the window to an empty panel.**
      The workspace column is `minmax(360px, 42vw)` — 538px on a 1280px desktop,
      wider than the chat beside it — and it held that space to display
      "Select a project" while the conversation had 400px. It now gives the
      column up until there is a workspace to put in it; an explicit collapse
      still wins, so the user's own choice is not second-guessed.
      *Evidence:* measured 400px → 938px with no workspace selected, and the
      panel returns to 538px once one is chosen; e2e "desktop layout › does not
      spend half the window on an empty workspace panel".

- [x] **Top bar density.** Measured: context bar 42px + tab strip 57px + quick
      actions 65px = 164px, so the list only began at y=199 — a fifth of an
      839px screen before any content. Two of the three quick actions duplicate
      the list below them (you pick a project from the list; "Open session" is
      the same sheet the context bar opens), so the row now appears only when it
      is the way forward: an app with no projects yet, or a section where
      starting a session is possible and not otherwise offered. The list starts
      at y=134.
      *Evidence:* `quickActionVisibility.test.ts` (5 cases, including that an
      empty app keeps the row) and e2e "navigation density › does not stack a
      third bar above the list when it is redundant".
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
- [x] **Keyboard avoidance.** Measured, and it did not hold: with a 320px
      keyboard the send button sat at y=799 while only 519px stayed visible, so
      it was covered by 280px. The shell is `position: fixed` at `100dvh`, and
      `dvh` follows the layout viewport, which a soft keyboard does not shrink —
      only the visual viewport does. The shell now subtracts the covered height,
      putting the send button at y=479. The inset is computed rather than
      assumed to be the keyboard height, since the visual viewport also moves
      under pinch-zoom and a collapsing URL bar.
      *Evidence:* `keyboardInset.test.ts` (8 cases) and e2e "soft keyboard ›
      shortens the shell so the composer stays above the keyboard", which drives
      the real `visualViewport` resize and asserts the inset is applied **and**
      released. Still worth a check on a physical device, since a headless
      viewport cannot reproduce every browser's keyboard behaviour.
- [x] **Attachments above the input, no delivery dropdown, correct caret size.**
      Attachment chips precede the editor; delivery is derived at send time
      (`effectivePromptAttachmentDelivery`) with no UI selector left; the caret
      line box is 22px empty and typed alike, after the placeholder was taken
      out of flow.
      *Evidence:* `PromptEditor.restorePrompt.test.ts` for the chips, and e2e
      "composer › keeps the caret one line tall before anything is typed", which
      also asserts the placeholder is still shown so hiding it cannot pass.

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
      *Everything but the button is built and tested:* `voiceCapture.ts` (tap
      and VAD rules, 14 tests), `speechToText.ts` (configurable transcription,
      14 tests), `voiceController.ts` (sequencing and failure paths, 11 tests),
      `browserVoiceRecorder.ts` (microphone binding, thin by design with the
      level maths covered by 5 tests). What remains is the composer control
      itself: render the button only when `speechToText.endpoint` is
      configured, show `voiceCaptureLabel(state)`, and insert the transcript
      through the editor's existing text-replacement path.
- [x] **VAD rules decided and tested.** Silence before speech never ends the
      recording (thinking time), a pause mid-sentence does not end the utterance
      (900ms trailing threshold, asserted to not fire at 800ms), stopping
      mid-utterance keeps what was said rather than discarding it, and a runaway
      recording is capped — transcribing if speech was heard, dropped if it was
      only silence. Every state has a label, so the feature can never fail
      silently. *Evidence:* `voiceCapture.test.ts`, 14 cases.
- [x] **STT is user-configured, absent by default.** Per the user's decision,
      `speechToText.endpoint` in the PI WEB config is the whole feature switch:
      with nothing configured there is no dictation control and nothing is ever
      recorded, because sending audio somewhere should be a deliberate choice
      rather than a consequence of a browser API existing. Point it at a local
      Whisper server and the audio stays on the machine.
      *Evidence:* `speechToText.test.ts`, 14 cases covering the opted-out state
      (never calls the service), the Whisper-style response shapes, and every
      failure path returning a message rather than failing silently.
- [x] **Transcribed text is handed to the caller, never auto-sent.** The
      controller calls `onTranscript`; nothing in it can send. The user reads
      what was heard before it goes anywhere.
- [x] **Permission, offline and no-speech states are visible.** A denied
      microphone is reported distinctly from any other device failure; an
      unreachable service reads as a service problem; an empty transcript says
      "No speech was recognised" rather than inserting nothing. Every state
      carries a label. *Evidence:* `voiceController.test.ts` (11 cases) and
      `speechToText.test.ts` (14 cases).

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
