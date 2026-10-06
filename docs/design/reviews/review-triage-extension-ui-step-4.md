# Review triage: extension UI step 4 (`editor`, composer writes)

Commit reviewed: `aec00a4d`. Workflow `3549c719`: lane A daemon (`botim-bllm/deepseek-v4.1-flash:max`),
lane B browser (deepseek), lane C full pass (`anthropic-merchant/claude-opus-5:max`). All three: OK with notes.

## Fixed

| # | Lanes | Finding | Settled by | Fix |
| --- | --- | --- | --- | --- |
| 1 | A F7, B 2, C F1 | The card passed a constant `false` for "Shift really pressed", so under 760 px or on a touch screen Shift was ignored: on a 700 px desktop window Shift+Enter added a line where the composer sends, and with Enter set to "send" no key added a line. | `promptEnterBehavior.ts` trusts Shift there only after a real Shift keydown; the composer tracks it. | The card tracks the Shift keydown, keyup and blur as the composer does. |
| 2 | A F1, C F2 | A `setEditorText` from a `session_start` hook was dropped on the pending-start row. | `applyPendingStartEvent` routed only dialog and status frames. | The pending-start row writes its composer; the draft moves with the row when the session is ready. |
| 3 | C F3 | The composer memory grew inside `piSessionService.ts` with an undocumented lifetime. | Read. | Its own unit, `extensionComposer.ts`, which states it lives per runtime and outlives a reload of the extensions, as pi's composer does. |
| 4 | C F4 | Two docstrings listed only confirm/select/input; the card's class docstring sat two functions above its class. | Read. | Both lists name `editor`; the docstring sits on the class. |
| 5 | C F5 | `prefillCut` was parsed with a bare number check. | `optionalNumber` accepts NaN and negatives. | Parsed as a positive safe integer. |
| 6 | A F4 | The 32,000 cut could split a surrogate pair. | `slice` counts UTF-16 units. | The cut steps back one unit before a high surrogate. |
| 7 | B 1 nit, A F9 | The re-render fingerprint ignored `prefill` and `prefillCut`. | `askCardIdentity.ts`. | Both are part of it. |
| 8 | A F6 | `plugins.html` and `config.html` said the dialog timeout defaults to 5 minutes; `config.md`/`html` listed only three dialog kinds. | `DEFAULT_EXTENSION_DIALOGS_TIMEOUT_MS = 0`. | Corrected; `editor` listed with its cancel value. |
| 9 | A F2 | A browser loaded before this version draws no editor card, and the dialog waits (default timeout 0). | Older parsers drop an unknown kind, never the status. | Documented: reload the page, or the timeout ends it. |

## Not fixed, with reason

| Lanes | Finding | Reason |
| --- | --- | --- |
| A F1 (b), B 4 | A composer write that lands while a browser is still opening the session, or that a reload's delta replay re-serves, is not applied. | Not safe to apply: the persisted watermark is written only at the join snapshot (`sessionController.ts`), so the replay re-serves frames this browser already applied, and exempting the frame from the watermark would re-apply an old `set` over the reader's newer typing or paste twice. Documented as a caveat; a durable carrier belongs to server drafts (owner, 2026-10-05: one draft per session, shared across devices, including an extension input's answer). |
| A F3 | `getEditorText` starts empty after the runtime is replaced (tree navigation, fork). | Documented in `extensionComposer.ts`; pi's composer is per process too. |
| A F5, C F6 | `setEditorText` text is unbounded. | There is no card on which to say it was cut; `notify` is unbounded the same way. |
| A F8, B 7 | The settled row shows one line of an editor's answer. | Owner question. |
| B Q1, C F7 | A half-written editor answer is lost on a reload. | Covered by server drafts (owner ruling above), as for an input's answer today. |
| B Q3 | `pasteToEditor` does not focus the composer. | It must not take focus from the card or field the reader is in. |

## Owner question

1. The settled card of an answered `editor` shows "Answered: " and the first line of the text. Keep one line, or show more (wrapped, or tap to expand)?
