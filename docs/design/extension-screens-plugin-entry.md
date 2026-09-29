# Extension screens: native when declared, a parsed card otherwise

Owner, 2026-09-30, on the goal extension's questionnaire and "Confirm Goal Draft" screens mirrored as a terminal dump: "又丑，我也没法选，点了没反应，还不原生，完全背离了我们插件写原生UI的初衷". Then: "需要使用 pi web UI 的插件入口，这才是正确的；如果只有 TUI 的 ui.custom 只能退化，给一个通用兜底；一个插件可能同时有 pi web UI 的入口和 TUI 的入口，不要显示两次".

## What happens today

`ctx.ui.custom(factory)` runs the extension's terminal component in the daemon with a stand-in terminal (2f4e41e0). The browser receives the lines the component drew, guesses a menu from them (`dialogScreenShape.ts`), and turns a tap into "(target line − cursor line) arrow keys, then Enter" (`dialogScreenKeys.ts`).

Both screenshots are pi-goal screens: `runGoalQuestionnaire` (the "Write your own answer..." option is its `CUSTOM_ANSWER_LABEL`) and the draft confirmation. They fail three ways:

- **Ugly.** Box rules, a wrapped option broken into its own row (the lone ")"), a key row.
- **Taps do nothing.** An option that wraps or carries a description line makes the line distance differ from the option distance. The walk lands on a line that is not an option, and the tap returns without a word.
- **Not native.** The goal extension has a pi-web plugin (the Goals drawer section), yet its dialogs bypass it entirely.

Before 2f4e41e0, `ctx.ui.custom` resolved `undefined` in pi-web. pi-goal then fell back to `select`/`input`, which pi-web draws as native cards. That is the "以前很原生的页面".

## What pi-web already draws natively (confirmed with the owner, 2026-09-30)

- **The Questions card** (`AskUserCard`): several questions, options with details, a Custom free-text choice, Back/Next and progress. pi-web's own `ask_user` uses it.
- **The dialog cards** for `ctx.ui.select`, `input` and `confirm` (`ExtensionDialogCard`). pi-goal and pi-ask-user fall back to these when `ctx.ui.custom` resolves `undefined`. Today the owner reaches them only by closing the mirrored screen first: "显示两遍，需要先 cancel TUI 那一层".

Only `ctx.ui.custom`, a terminal component, has no native form. The goal questionnaire (its drafting questions and the draft confirmation) is exactly the Questions card's shape, so it reuses that card instead of getting a new one.

## Owner decisions (2026-09-30)

- Home of the goal extension's native screens: the bundled Goals plugin, over a pi-web plugin shipped inside pi-goal. (See "Where the Goals plugin stands": the core Questions card covers them today.)
- The generic fallback for terminal-only screens is the parsed card: options as real buttons, taps that walk and verify, the key row only when a screen does not parse.
- Go.

## What is built

### A screen declared as questions is the Questions card, once

- `ctx.ui.custom(factory, { web: { kind: "questions", title?, questions: [{ id, question, detail?, options: [{ value, label, detail? }], multiple?, custom?: false }] } })`.
- The daemon reads the declaration defensively (`declaredScreen.ts`). A detail may carry a whole proposal (8000 characters). Anything that does not fit reads as undeclared and the screen falls back to its drawn lines.
- A declared screen never mounts its terminal component. The dialog carries the declaration, the browser draws the `ask_user` Questions card, and `custom()` resolves with the reader's `{ answers: [{ id, values, otherText? }] }`, validated against the declared questions. `custom: false` hides the Custom choice and refuses typed text.
- `ctx.ui.piWebScreens` lists the declarations the host draws (`["questions"]`). A headless host and a closed card both resolve `custom()` with `undefined`. An extension reads this list to tell which one it got, so it does not ask a second time through `select`/`input`.
- The closed record and the notification name the chosen labels, not the option values.

### The menu declaration of 65592b55 is removed

It never reached the browser. The dialog store rebuilt the dialog from its kind's fields and dropped `screen`, and the browser's parser dropped it again. So the task-list confirmation that declared it still arrived as a terminal frame. Questions cover what it meant, so the dead path goes instead of being revived.

### pi-goal (Gang-of-Beads/pi-goal)

- `web-questions.ts`: `hostDrawsQuestions`, `questionsOption`, `readWebAnswers`.
- The questionnaire declares one question per question. Options are keyed by index, because the model writes the labels. The recommended option says so. The draft confirmation's auditor toggle becomes a last On/Off question that keeps its default when unanswered.
- The task-list confirmation declares one question: the proposal as detail, Confirm and Keep as options.
- A card closed unanswered cancels and keeps the tasks. It does not fall back to `select`.
- The escape dialog and the task-list overlay open only from terminal keys (Escape during an audit, Ctrl+Shift+T), which pi-web never sends, so they stay undeclared.

### Where the Goals plugin stands

Every goal screen pi-web can reach fits the core Questions card, so the Goals plugin needs no renderer yet. A plugin contribution for extension screens (`extensionScreens`, keyed by a screen id, with `answer(value)` and `cancel()`) waits for a screen the Questions card cannot draw.

## Next: the parsed-card fallback

For an extension that ships only `ui.custom` (pi-ask-user, the updater, anything third-party):

- **Parse by option, not by line.** A continuation line (deeper indent, no cursor or number) joins the option above it. A description line under an option belongs to that option.
- **Tap by walking and checking.** Send one arrow, read the redrawn screen, and stop when the cursor line carries the tapped option; then Enter. The walk is bounded. When it cannot reach the option, the card says so instead of doing nothing.
- The key row stays for screens that do not parse as a menu.

## Gate lane 1 (Opus, reviewer) on 74b74112 + pi-goal ab8c791: PASS

Verdict: no P0 or P1. Each finding was checked against the source.

| Finding | Verdict | Disposition |
|---|---|---|
| F1 (P2): questions dialogs have no Cancel. Declining meant "Send anyway" with nothing, recorded as "Answered". | TRUE | Fixed. The card offers Cancel, which closes the dialog without an answer, so `custom()` resolves `undefined`. |
| F2 (P2): a partial web send read as a finished questionnaire, and skipped questions vanished for the model. | TRUE | Fixed in pi-goal 9070b9b. A skipped question reads "(left unanswered)". Terminal output is unchanged. |
| F3 (P2): a refused declaration silently drew the terminal frame again. | TRUE | Fixed. The daemon logs `[extension-screen] declaration refused` with a shape summary. pi-goal declares only what fits and treats blank context as absent. |
| F4 (P3): no options plus `custom: false` could not be answered. | TRUE | Fixed. The daemon refuses that combination, and pi-goal no longer declares it. |
| F5 (P3): the card lost its chrome: the heading always read "Questions", "Sending..." never showed, and the message was wrong. | TRUE | Heading and "Sending..." fixed. The message is moot: the store keeps no message for a `custom` dialog. |
| Draft lost when the card is recreated (P3) | TRUE | Fixed. The dialog card passes the session's draft key. |
| A queued second question set opened on the previous set's step (P3, `ask_user` too) | TRUE | Fixed. A new set opens on its first question. |
| One malformed dialog fails the whole session status (P3) | TRUE | Not fixed. Dropping the dialog alone would leave its extension waiting on a card nobody sees, and it is reachable only through a future screen kind. |
| A tab from before 74b74112 draws an empty frame for a questions dialog (P3) | TRUE | Not fixed. Only during a rolling upgrade, and updates now restart both processes. |

## Gate lane 2 (DeepSeek, reviewer) on 163e9fff..83cc4d83 + pi-goal f431278..9070b9b: PASS

Verdict: no P0 or P1. The first attempt timed out searching the whole home directory; the retry was limited to the two repos. Each finding was checked against the source.

| Finding | Verdict | Disposition |
|---|---|---|
| P2: a new question set asking exactly the previous questions kept the previous step and answers. `askCardFingerprint` read `id`/`requestId`, while the ask carries `askId`; its test built `{ id }` and hid this. | TRUE | Fixed. Both fingerprint shapes are picked from the wire types, so a renamed field is a compile error. The dialog fingerprint had the same flaw (`expiresAt` for `timeoutAt`). The radio and text bindings use `live()`, so a stale DOM value cannot survive a reset. |
| P3: pi-goal could send duplicate question ids or option values, which pi-web refuses. | TRUE | Fixed in pi-goal e689dd0. |
| P3: a draft proposal over 8000 characters was not declared, so it drew the terminal frame again. | TRUE | Fixed. A declared detail may be up to 32000 characters (`EXTENSION_SCREEN_DETAIL_MAX_LENGTH`), on both sides. |
| P3: `boundedArrayOf` passed the index as a parser's second argument. | TRUE (latent) | Fixed. It passes the item alone. |
| P3: the notification read "nothing" where the transcript says otherwise. | TRUE | Fixed: "an empty response" for an input dialog, "no answers" for a questions screen. |
| P3: no countdown on a questions card. | TRUE | Not fixed. Only an extension-passed timeout shows one, and pi-goal passes none. |
| P3: the probe's fixture lives outside the repo (`~/.pi/agent/extensions/ui-custom-probe.ts`). | TRUE | Not fixed. It is shared with probe-custom-screen, and the probe fails loudly at leg 1 without it. |
| P3: `custom: false` with a stale `otherText` draft is refused only by the daemon. | TRUE | Not fixed. The card offers no Custom choice for such a question, so only a hand-edited draft reaches it. |
| P3: Cancel and "Send anyway" with nothing both read as cancelled in pi-goal. | TRUE | Kept. Sending nothing is declining. The daemon record still tells them apart ("Cancelled" vs "Sent without answering"). |
