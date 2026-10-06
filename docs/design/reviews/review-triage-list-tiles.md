# Review triage: list tiles per row

Commit reviewed: `14990de6`. Workflow `6bfdec8e`: lane A config and saving
(`botim-bllm/deepseek-v4.1-flash:max`), lane B rendering and the card (deepseek), lane C full pass
(`anthropic-merchant/claude-opus-5:max`). All three: block. Each item settled against the source.

## Fixed

| # | Lanes | Finding | Settled by | Fix |
| --- | --- | --- | --- | --- |
| 1 | A A, B F1 | Saving Settings → General → gateway server config deleted `listTiles` (and a hand-set `logging`, pre-existing). | `preservedGatewayConfigRemainder` carried an allowlist without them, and `savePiWebConfig` deletes every key it knows that the save does not carry. | The gateway save keeps every key of the file config and replaces only host, port and allowed hosts, so a key added later cannot be lost the same way. |
| 2 | C F1, B F4 | Before a choice the card marked "what today shows", so on the desktop it marked "One per row" while the full-width page drew five, and tapping the marked option sent nothing. | `shownListTiles` filled in a default; a checked radio fires no change. | Nothing is marked until a choice exists, as the card's own sentence says; `shownListTiles` and its table are gone. |
| 3 | A C, B F4, C F2 | After a failed save the radio stayed on the option that was not saved. | Lit skips a property write whose value did not change. | The checked binding goes through `live`, as AskUserCard's does. |
| 4 | B F3 | The card showed the dialog-wide error (a plugins load failure, another card's save) and owned none of its own. | `.listTilesError` was bound to `this.error`. | The Lists save keeps its own saving flag and error. |
| 5 | A B, B F2, C F5 | Any whole-config save (Lists, Shortcuts) erased a hand-set `environmentFacts`. | The request parser never read it; `savePiWebConfig` deletes and rewrites it only when carried. | The request parser reads `environmentFacts`. |
| 6 | C F3 | `config.html` lacked the page-nav link, the matrix row and the reload line. | Read against `config.md`. | Added. |
| 7 | B F6, C F4 | The docs said a phone on its side uses the desktop layout. | The phone layout is a touch screen or a window under 760 px (`createMobileNavigationMedia`); the 850×393 row was measured with a fine pointer. | `config.md`, `config.html` and the design doc say so. |
| 8 | B F8 | "Tiles per row in Sessions, Machines and Projects" also reads as covering session search, which keeps its own grid. | `QuickSwitcher.ts` lays out its own results. | The card names the Navigate lists. |

## Not fixed, with reason

| Lanes | Finding | Reason |
| --- | --- | --- |
| B F5 | Two per row in a sidebar dragged to its minimum leaves a sliver of title. | The owner chose the option; at the default 340 px titles keep about eight characters (shown before the ruling). Revisit if the narrow case is reported. |
| B F9 | No way back to "fit the width" once a layout is chosen. | The owner ruled two options (ask `cb9e31f7`). |
| B F7 | The changeset asks for a web-process restart though the config is read per request. | The restart is for the new code that accepts the key, not for a hand edit. |
| A nit | The first paint can use the width rule before the config read lands. | The list is empty until sessions arrive; not reproduced. |
