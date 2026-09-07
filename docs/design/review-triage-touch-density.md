# Touch-density wave review triage (2026-09-07)

Two-lane bllm review of the L1 wave (commits `b5be3fcc..fe71b6b1`): lane A
(glm-5.3-flash, consistency) and lane B (qwen3.8-flash-next, red team). Artifacts:
`/tmp/lane-a-consistency.md`, `/tmp/lane-b-redteam.md` (session copies under
`subagent-artifacts/e17e2a10*` / `c70623a1*`). Merge verdict from both lanes:
**OK with notes** — no live 393x850 rendering bug; the notes below triaged
before the follow-up commit.

## Fixed in this triage

| # | Finding (lane) | Fix |
|---|---|---|
| 1 | 44px remove badge swallows the zoom target on a 64px attachment chip; free square 20px < AA (B P1-1) | Chip grows to 72px coarse; badge 44px keeps a 28px free corner (≥ AA) |
| 2 | QuickSwitcher corner toggle grew to 44px without growing `.row-title`'s 30px reserve; menu button swallows taps aimed at a clamped name's tail (B P1-2) | `.row-title { padding-right: 52px }` in the coarse block |
| 3 | SessionList comfort floors gated on `max-width: 760px`, not pointer type; wide coarse pointers (iPad) keep mouse-sized controls (A1, B P2-3) | Floors moved to an unconditional `@media (pointer: coarse)` block at the sheet end; the 760px block keeps only the 16px zoom guard |
| 4 | ExtensionDialogCard coarse rule nested in `@container (max-width: 580px)`; wide coarse containers get no floor at all (A4) | Hoisted to a sheet-level `@media (pointer: coarse)` block |
| 5 | `.action-menu-panel button` (shared list row menus) left at ~34px while the QuickSwitcher equivalent got 44px (B P2-1) | Added to the shared listStyles coarse block |
| 6 | Plain-text textarea reserves only 44px for the now-44px attach overlay; caret/tails hide under it (B P2-4) | Coarse `textarea { padding-right: calc(var(--pi-space-4) + 44px) }`; cm overlay bumped to 58px; guarded in `composerRoom.test.ts` |
| 7 | 44px retyped ~20 times beside `--pi-control-height-touch`, the token that exists to be stated once (A2) | All new coarse blocks consume `var(--pi-control-height-touch, 44px)` |
| 8 | Quick switcher search/rename inputs stayed 40px on coarse (probe-found while re-running) | Added to the QuickSwitcher coarse block |
| 9 | `.session-checkbox` native ~13px, below AA, invisible to the probe (lane B progress note) | 24x24 (fits the existing 32px `.action-main.selecting` gutter); comfort exemption recorded |
| 10 | Probe exemptions were class-substring with no context; hit-slop skipped the AA floor too; no coarse-media assertion; hardcoded Chromium path (B P1-3, B P2-5) | Structured exemptions (`require: ".list-body.tiles"` for the tile menu), AA enforced before any skip, `matchMedia("(pointer: coarse)")` fails loudly, `chromium.executablePath()`; `input` added to the audited selector |
| 11 | Fullscreen contract doc: backdrop is unreachable in fullscreen, so close() is the only dismissal (B P2-2 doc part) | `plugin-api.ts` + `plugins/types.ts` docstrings state the close-control requirement; baseline regenerated |
| 12 | `PromptEditor.ts` hardcoded `(max-height: 620px)` beside the published breakpoint (B P3) | Interpolates `SHORT_VIEWPORT_MEDIA_QUERY` via `unsafeCSS` |
| 13 | e2e comment enumerated only two of the recorded exemptions (A7) | Points at the probe's exemption block as the ledger |

## Not fixed, with reason

- **Safe-area insets for fullscreen plugin dialogs (B P2-2 CSS part)** — no
  consumer uses `presentation: "fullscreen"` yet; the contract sentence (fix 11)
  covers the dismissal path. Land `env(safe-area-inset-*)` compensation with the
  first fullscreen consumer.
- **Cascade-order guard tests for the seven new coarse blocks (A3)** — the
  ChatView drawer guard exists and this review verified no live ordering bug
  (both lanes checked every later rule). Extending the pattern to each sheet is
  a bounded test-coverage change that belongs in its own wave.
- **Probe wiring into CI (B P2-5 part)** — the probe is machine-bound
  (drive-the-real-UI stack, sessions with data); CI wiring is an owner decision.
  It is documented as a manual step run against `scripts/stack-8505.sh up`.

## Judged not true

- **Contract drift across plugin-api/types/baseline (A suspicion)** —
  byte-identical, smoke-enforced; adjudicated false by lane A with evidence.
- **44px bumps overflow 393px rows (B hunt area)** — false for width; the two
  real neighbour-swallowing cases are fixes 1 and 2.
- **`createRenderRoot` adopt double-adopt/leak (B hunt area)** — false, not in
  this diff.
- **SHORT_VIEWPORT publication enables host/plugin CSS fights (B hunt area)** —
  false; the height space is CI-enumerated (`ALLOWED_HEIGHTS = {620}`).
- **Probe `[role=option]`/`[role=menuitem]` omission hides live offenders
  (A suspicion)** — no below-floor elements with those roles on the audited
  surfaces; recorded as future surface work, not a violation.
