# Round 25 — lane C: claim identity, the retirement model, interrupted runs, row marks

Repository: `/Users/hanxiao.du/Desktop/vincent/projects/pi-web`
Branch `refactor/plugin-architecture`, HEAD `bee891a3` (round 25 base). Read-only audit.

## Scope and method

Round-17+ surface only: the banner retirement model (`notice.ts`, `errorNotice.ts`,
`transportHealth.ts`, `http.ts`, `PiWebApp.clearTransientError` /
`scheduleTransientErrorDismissal` / `renderErrorBanner` / `bannerHold.ts`), the state
rail and row marks (`shared.ts`, `sessionStateBadgeStyles.ts`, `sessionRowIndicator.ts`,
the three `activityBadge.ts` copies), the interrupted-runs path
(`refreshInterruptedRuns`, `QuickSwitcher`, `quickSwitcher.ts`), the MachineSwitcher
removal's residue, and the claims the round-17…24 changesets and design docs make about
that code. Every controller write to the banner field was enumerated; the rail cascade
was re-derived by specificity; the interrupted-runs state machine was walked through
each of its three call sites; the pointer-order guard was re-run with a broader
element-selector/different-selector variant to test its blind spots.

## Verdict

The retirement model holds where it was fixed. No controller writes the global banner
outside the seam; the hold/expiry/re-arm gates all compare the raw claim rather than the
displayed wording; the rail cascade is honestly ordered and its comments match the rules
on the page. The defects this round are in two places the model's own fixes did not
reach: **the interrupted-runs banner's retraction is unreachable in the recovery path its
own sentence promises** (F1, the strongest finding of the lane), and **the unread
semantic still wears a second colour** (F2) — the exact defect class round 23 recorded
as fixed two lines above it. Both are direct residues of landed round-20/23/24 fixes,
not new producers. The rest is documentation that now describes a component the branch
deleted, and marks whose emitted classes the sheet never styled.

---

## F1 — P2 (Medium-High), code: the "interrupted-run status is unknown" banner can never be retracted by the reconnect it demands

`src/client/src/components/PiWebApp.ts:778-806`, `refreshInterruptedRuns`:

```
787:      if (ids?.size === 0 && !adoptEmpty) return;      // empty-record guard
788:      if (ids === undefined) { this.interruptedRunsUnknown = true; …banner…; return; }
…
802:      if (this.interruptedRunsUnknown) {               // the retraction
803:        this.interruptedRunsUnknown = false;
804:        if (this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE) this.setState(clearErrorPatch());
```

The empty-record guard at 787 runs **before** the failure check at 788 and **before** the
retraction at 802-804. The daemon's record is read-and-clear (the file's own comment at
761-770 says so), so after any successful read every later read answers empty. Reachable
sequence:

1. Boot read succeeds and is empty → `interruptedRunsBootReadDone = true` (797), nothing announced.
2. The socket drops; the reconnect read at `PiWebApp.ts:1970` (`adoptEmpty: false`) **fails** → 791 sets `interruptedRunsUnknown = true` and paints `INTERRUPTED_RUNS_UNKNOWN_MESSAGE` (249): *"Interrupted-run status is unknown: the read failed. Reconnect to read it again."*
3. The machine answers. The next read — reconnect (`:1970`) or opening the quick switcher (`:2503`), both `adoptEmpty: false` — **succeeds** and returns an empty set, because the record was spent at boot. Line 787 matches (`size === 0 && !adoptEmpty`) and returns.

`interruptedRunsUnknown` stays `true` and the banner stays. Nothing else can remove it:
the notice is `noticeForReader` (reader-retired), so `clearTransientError` returns at
`PiWebApp.ts:1055` on the `errorRetiredBy !== RetiredBy.reply` test, and
`scheduleTransientErrorDismissal` returns at `:1092` on the same test — and the wording
table has no rule for this sentence, so even a reply-retired version would not expire.
`selectMachine` does not clear reader claims either, so it survives a machine switch and
is dismissed only by the reader's × button.

The retraction at 802-804 is therefore reachable only through a read that returns a
**non-empty** set — i.e. only when a *new* restart cuts off new runs, the very event the
banner is about. The recovery path the banner promises ("Reconnect to read it again")
provably cannot deliver it.

Why this is new: round 20 §7 made the retraction read the flag rather than the wording,
round 23 made emptiness non-adoptable after boot, and round 24 §2 made the boot read
once-per-page and §9 reworded this banner so that it "promises only what a reconnect can
deliver". Round 24's rewording is the claim the ordering defeats, and the three fixes
together are what closed the escape. No test covers it — `refreshInterruptedRuns` has no
test file (`grep` over `src/client/src/**/*.test.ts` finds no reference).

Fix: the flag describes the *read*, not the record, so clear it on any successful read,
before the emptiness decision:

```ts
const adoptEmpty = options.adoptEmpty ?? !this.interruptedRunsBootReadDone;
if (ids !== undefined && this.interruptedRunsUnknown) {
  this.interruptedRunsUnknown = false;
  if (this.state.error === INTERRUPTED_RUNS_UNKNOWN_MESSAGE) this.setState(clearErrorPatch());
}
if (ids?.size === 0 && !adoptEmpty) return;
```

and move the same `interruptedRunsUnknown = false` reset to the machine-selection path or
gate the flag per machine, the way `interruptedSessionIds` already is
(`:3979` blanks the set when `interruptedSessionIdsMachine !== selectedMachineId(state)`,
but the flag and its banner have no such gate — machine A's unknown state is still
announced while the reader is looking at machine B). Add a test that fails the read once,
then succeeds with an empty set, and asserts the banner is gone.

## F2 — P2 (Medium), code + docs: round 23's "one purple motif" stopped at the halo; the unread ring still wears the running colour

`.changeset/round-twentythree-fourth-copy.md:19` claims "the unread halo is one purple
motif", and `src/client/src/components/shared.ts:457-460` states the reason:

```
458:  /* The unread halo is the same motif as the session vocabulary's
459:     (.session-state.unread): a purple core with a purple 22% halo. The
460:     accent mix here was a second colour for one semantic. */
461:  .activity-indicator.unread { … background: var(--pi-purple); box-shadow: 0 0 0 2px color-mix(… var(--pi-purple) 22% …); }
462:  /* Unread + ongoing work: a static accent ring wraps the still-pulsing work dot. */
463:  .unread-ring { … border: 1.5px solid var(--pi-accent); … }
```

The fix changed the `box-shadow` and left the *border two rules below it*, which is the
same motif in the composite case — the sheet's own comment at 432-436 calls `.unread-ring`
the ring the unread fact is drawn with. Three consequences, all verifiable:

- **`--pi-accent` (#58a6ff, `src/client/index.html:157`) is the rail vocabulary's "running"
  and "selected" colour** — `.action-row:has(.session-state.running)` (`shared.ts:446`),
  `.action-row:has(.activity-indicator.terminal)` (`:448`), `.action-row.selected` (`:451`),
  and `.state-dot` (`sessionStateBadgeStyles.ts:41`). An *unread* mark wearing it is a
  second colour for one semantic and a first colour for two, which is the sentence at 460
  describing itself.
- **A machine/project/workspace row that is unread and terminal draws an accent ring
  around an accent square** (`shared.ts:463` border vs `shared.ts:453` dot background): the unread half of the composite is invisible at any
  distance, and the rail is accent either way, so "unread + terminal" and "terminal"
  render identically except for the ring's shape.
- The composite therefore spends **three colours where the sheet claims one**: ring
  accent, wrapped dot success/terminal-accent, rail success (438-449 match the wrapped
  node, per the comment at 432-437). The session vocabulary's answer to the same state is
  a single purple dot (`sessionRowIndicator.ts:54` ranks `unread` above `error`/`background`),
  so one screen shows "unread plus work" as purple-with-no-ring on session rows and
  accent-ring-plus-green on machine rows.

Either the ring takes `--pi-purple` (one motif, and the comment at 462 stops contradicting
460), or the owner rules that the ring is a *work* frame rather than an unread mark — in
which case 460's "second colour for one semantic" no longer describes what it fixed, and
the changeset line overstates. This is a decision, not a typo: it needs the owner's call
on which the ring is.

## F3 — P2 (Medium), docs: the living element inventory still assigns the machine list to the core, next to a component the branch deleted

`docs/design/element-native-vs-plugin.md` declares at its head (lines 4-6) that it "covers
every rendered surface, states the current home with file:line evidence". The row at
line 45 is wrong twice over:

```
45: | Machine list / machine switcher | `MachineList.ts` | native — ruled core method |
```

- The switcher was deleted (`.changeset/banner-retirement-model.md:19`; `MachineSwitcher.ts`
  is absent from the tree).
- The list is not native. It is contributed by the plugin
  (`pi-web-plugins/machines/browser/MachineList.ts`, mounted through the slot in
  `AppNavigationPanel`), and `.changeset/machines-slot-builtin-fallback.md` states the
  opposite of "core method" explicitly: "With no contribution the machine step hides …
  instead of rendering a core list". `AppNavigationPanel` has no builtin machine list to
  fall back to (`grep -n builtin` in that file: no hits).

The "native — ruled core method" verdict may be a carried-forward ruling the doc says it
does not re-litigate, but the *Home* column is a factual claim and it is stale. Round 20
item 10 and round 23 item 11 both record the switcher's citations as retired; this one
survived because it is in an inventory rather than a comment.

## F4 — P3 (Low-Medium), code + doc: the interrupted mark is a second, unranked producer of the row mark, and it wears colours the arbiter reserves

`sessionRowIndicator.ts:9-32` states the contract: "This module replaces composition with
a ranking… resolves exactly one indicator", with the priority table (`asking` amber =
"the reader must act"; `background` purple = *hollow ring*). The interrupted marker
sidesteps that module entirely on the one surface that renders it:

`src/client/src/components/QuickSwitcher.ts:198-215` — `interrupted` replaces the arbiter's
element with `.row-flag.interrupted`, which is `border: 2px solid var(--pi-warning)`
(`:454`) at `--pi-dot-md`. So the mark wears **amber**, which this vocabulary means "ask_user
waiting on the user", and **hollow-ring geometry at the badge's own size**, which this
vocabulary means "background work still running". A session whose turn ended and whose run
was then cut off reads as "waiting on you".

The predicate also differs from the one the grouping uses: the mark yields only to
`rawStateKind !== "working"` (`:198`, where `sessionStates` wins over the
`activeSessionIds` fallback at `:193`), while `quickSwitcher.ts:136` places the row with
`interrupted.has(id) && !active.has(id)`. A session that is in `activeSessionIds` and
whose activity kind is `asking` therefore sits in the **"Active" group wearing the
restart-cut marker** — the visible symptom of the split round 24 deferred. The `unread`
mark is dropped too (`stateKind = undefined` at `:199` and the ternary at `:215` never
reach `sessionRowIndicator`), so an interrupted unread row loses its purple as well.

This extends round 24's deferred item ("QuickSwitcher's interrupted predicate split")
rather than repeating it: the deferral is about *which predicate decides*, and what is
missing from the record is that the mark also speaks **outside the colour table** the
same wave declared authoritative, and that the divergence is visible on screen.

The three-line comment at `:195-197` contradicts its own code: it says the marker
"yields to the live state (three dots / green / amber / red)", but the code yields only to
`working`, so amber (asking) and red (error) do **not** make it yield; and no session dot
wears green — since round 23 the session vocabulary is accent/amber/purple/danger/dim,
and `--pi-success` belongs to the machine vocabulary the same wave separated.

## F5 — P3 (Low), code: the idle class the renderer emits has no rule, so an idle machine row is styled as working

`renderActionActivityIndicator` (`pi-web-plugins/machines/browser/activityBadge.ts:31-46`,
byte-identical in the workspaces copy) emits `class="activity-indicator idle"` for an
empty row. **No stylesheet in the repo defines `.activity-indicator.idle`** (`grep -rn
"activity-indicator.idle"` across `src` and `pi-web-plugins`: no hits). The element
therefore takes the base mark rule, `shared.ts:395`:

```
.activity-indicator { … background: var(--pi-success); animation: pulse 1s ease-in-out infinite; … }
```

— i.e. the *working* colour and the *working* pulse. It is invisible today only because
the wrapper carries `[hidden]` and `shared.ts:393` restates `display: none`. That is a
one-rule dependency on the exact cascade trap that rounds 15 and 20 wrote
`idleMarkHonesty.test.ts` and the `[hidden]` companion rules to police: the mark that is
suppressed by a companion declaration rather than by having no colour of its own. Any
future `.action-activity { display: grid }`-style rule, or a variant that drops the
wrapper, lights a pulsing green dot on every idle machine, project and workspace row.
One line closes it: `.activity-indicator.idle { background: var(--pi-dim); animation: none; }`
(matching `.session-state.idle`), plus — better — a guard that every member of
`ActivityIndicatorKind` and `SessionRowIndicatorKind` has a declaration in the sheet that
renders it, which would also have caught the dead `.session-state.running` membership
round 23 item 6 fixed.

## F6 — P3 (Low), dead surface: `"sending"` is an unreachable activity kind

`ActivityIndicatorKind = "session" | "terminal" | "sending"` in all three copies
(`src/client/src/components/activityBadge.ts:7`,
`pi-web-plugins/machines/browser/activityBadge.ts:8`,
`pi-web-plugins/workspaces/browser/activityBadge.ts:8`), and its header says "call sites
resolve precedence (sending > session > terminal) before rendering". No call site does:
`statusActivityKind` never returns `"sending"` (`activityBadge.ts:18-24`) and no caller
passes it (the only call sites are `ProjectList.ts:236`, `MachineList.ts`,
`WorkspaceList.ts`, all from `statusActivityKind`). The rule round 21 deleted for exactly
this reason — `.action-row:has(.activity-indicator.sending)` ("before the first
action-row ever carries one", round 20 item 6) — had its *type-level* justification left
behind. The CSS class `.activity-indicator.sending` is still real, but it is emitted as a
literal by `SessionList.ts:325` on the pending-session row, not through this type. Either
drop the member and the precedence sentence, or state that the pending row is the
producer. The amber of `.activity-indicator.sending` (`shared.ts:455`) is a further collision in the same class: the
pending-session row paints "the client is sending" in `--pi-warning`, the colour the
session vocabulary reserves for an ask, and the moment the session appears the arbiter
renders the same fact as three accent dots (`sessionRowIndicator.ts:52`) — one claim,
two colours, changing as the row appears.

## F7 — P3 (Low), docs: state-count and colour claims that predate the arbiter

- `sessionStateBadgeStyles.ts:4` — "Shared four-state session badge (working/idle/asking/error)".
  `SessionStateBadgeKind` is five (it has `background`) and the sheet implements six
  marks, including `unread` and `running` — which the file's own table then lists (12-19).
- `quickSwitcher.ts:231` — "Four-state work badges" for the same five/six-kind map.
- `quickSwitcher.ts:237` — "a working session came to read as a green dot": no session
  dot wears green (`sessionStateBadgeStyles.ts` has no `--pi-success` for any
  `.session-state`), and this is the same stale colour as F4's `QuickSwitcher.ts:197`.
- `shared.ts:400-407` — "Each row carries a coloured edge instead … the rail is what the
  eye follows down the list". No rail rule matches `idle`, and
  `sessionRowIndicator(undefined, false)` renders nothing at all
  (`sessionRowIndicator.ts:58`), so for a typical list the majority of rows carry no edge.
  Almost certainly intended (nothing to report, nothing to colour), but the sentence says
  "each row", and it is the sentence a reader of the rail table will check.

## F8 — P3 (Low), docs: two more sentences about the deleted switcher, and a citation that now points at another feature

- `docs/design/phone-navigation-model.md:36` — "`machine-switcher` rendered permanently
  hidden" describes the phone panel through a component the branch deleted.
- `docs/design/web-plugin-runtime.md:208` — "with `pi-web-machines` absent there is no
  switcher". What is absent is the machine list and its management routes; see F3 and
  `.changeset/machines-slot-builtin-fallback.md`.
- `docs/design/element-native-vs-plugin.md:38` cites `PiWebApp.ts:777-783` for the
  self-update banner. That range is now inside `refreshInterruptedRuns` (778 is its
  signature); the banner is `renderSelfUpdateBanner` at `PiWebApp.ts:938` and its poll at
  `:873`. This is the file's only file:line citation, and the file's head promises it is
  evidence.

## F9 — P3 (Low), layering: the core's mark-honesty test pins a plugin file, and the copy it pins is not the copy the core renders

`src/client/src/components/idleMarkHonesty.test.ts:5` imports
`../../../../pi-web-plugins/machines/browser/activityBadge.js`. The machines and
workspaces copies are byte-identical (`diff` exit 0); the core copy
(`src/client/src/components/activityBadge.ts`) has diverged (it holds
`SessionStateBadgeKind` and `SESSION_STATE_LABELS` and has no
`renderActionActivityIndicator`). So three files carry one contract, the test reaches from
core into a plugin directory to check it, and the core copy of the name is untested. The
test's two `readFileSync` assertions (`shared.ts`, `AppContextBar.ts`) do at least pin the
companion `[hidden]` rules — extending the same block to assert F5's idle declaration
would make the file cover the gap it was written for.

## F10 — P3 (Low), guard: three structural blind spots in `pointerQueryOrder.test.ts`

The guard compares only identical selector text, within one file, within `@media
(pointer|hover)` blocks, and stops at the first later occurrence. Re-running it with an
element-selector and overlapping-selector variant found **no live violation today** — the
eight candidates are all different subtrees, identical values, or
specificity-correct interactions (`.list-body.tiles .action-menu-toggle` (0,2,0) inside
its own coarse block at `shared.ts` beats the base (0,1,0) rule, and `SessionList.ts:804`
correctly keeps its override inside its own coarse block). What the guard cannot see:

1. `SELECTOR` requires a `.` or `#` prefix, so `header button`, `input[type="checkbox"]`,
   `:host` and other element/attribute selectors raised inside a coarse block are invisible.
2. Only the *first* later occurrence of a selector is compared; a second later rule that
   does collide with the coarse block is skipped.
3. Scope is one file, so the adopted-sheet cascade is invisible — the host-order item
   round 24 already deferred. `.css` files are not scanned at all.

(1) and (2) are new; (3) is round 24's deferred note restated as a guard limitation.

---

## Confirmed still open from round 24 (unchanged at `bee891a3`, not re-argued)

- **Host stylesheet order** — `adoptMachinesHostStyles` (`pi-web-plugins/machines/browser/hostUi.ts`)
  and `adoptWorkspacesHostStyles` append the host's `surfaceStyles`/`listStyles` *after*
  the plugin's own `static styles`, so at equal specificity the host wins and a plugin's
  own declaration for a shared selector is dead. No selector+property collision exists
  today between `MachineList`/`ProjectList`/`WorkspaceList` and the shared list sheet;
  `SessionList` and `QuickSwitcher` put their own CSS last and win normally. Still the
  owner's architecture call, still latent.
- **Selected rails on urgency rows** — `.action-row.selected` (0,2,0, `shared.ts:450`) is
  accent, so a selected *asking* row wears a blue rail under an amber dot, against
  402-407's "never reads as one thing up close and another at scanning distance". The
  comment at 425-431 owns the override but not the vocabulary collision. Design call.
- **The local namespace and `machineIdFromUrl`** — `piWebStatusPath("local")` has no
  `/machines/` segment, so web-owned successes do not clear "local"-scoped claims, and the
  local machine's own claims are cleared only by machine-routed URLs. `transportHealth.ts`
  documents the first half as intended ("web-owned URLs prove nothing about any machine's
  link - not even the local one"); round 24's owner decision still stands.
- **QuickSwitcher has no rail at all** — its `static styles`
  (`QuickSwitcher.ts:407`) are `[interactiveSurfaceStyles, sessionStateBadgeStyles, css…]`;
  `listStyles` is not adopted and its rows are `.row`, not `.action-row`, so the phone's
  only session list has no rail. Not listed in round 24's deferrals; it is the
  desktop-only consequence of the same rail model, and worth stating as an owner call
  alongside the "each row carries a coloured edge" sentence in F7.
- **Desktop has no interrupted marker** — `interruptedSessionIds` is consumed only at
  `PiWebApp.ts:3979` (the quick switcher); `SessionList.ts` has no `interrupted` reference,
  so the desktop navigation panel never shows the mark the phone surface groups rows by
  (`quickSwitcher.ts:136`). F1's banner is the only desktop-side signal.

## Verified clean this lane

- **No producer bypasses the seam.** Every write to the global `error` field goes through
  `errorNoticePatch` / `noticePatch` / `clearErrorPatch` (112 call sites). The only two
  remaining `setState({ error: … })` writes are `authController.ts:152` and `:290`, and
  both set `authDialog.error` — dialog-local, never banner-routed. No fourth copy of the
  late-failure pattern, and the selection guard is shared by the runtime and health paths.
- **Identity of the schedule.** The re-arm gate (`PiWebApp.ts:3843`), the timer's clear
  test (`:1105`) and `clearTransientError` all compare the raw `state.error` plus
  `errorMachineId`; the banner *displays* the normalized wording but never stores it, so
  the shortening in `normalizeTransientError` cannot desynchronize the claim from its
  schedule. Round 24's per-machine schedule is intact.
- **Reply/reader split as documented.** Reply-retired transport claims are cleared only by
  a success for the matching machine (or any response for a `page` claim); the composed
  "X is unavailable; reconnecting… detail" and the exhausted remote-route-restore message
  correctly get no expiry (they assert a state, they do not report a timeout) and are
  cleared by the matching machine's answer, by `machineController.ts:107` on deletion, or
  by the reader. `noticeFromError`'s fallback regex assigns reply retirement without
  expiry exactly where the wording table declines to shorten — consistent with the model.
- **The rail cascade.** All `:has(:where(…))` rules are (0,1,0) and source order decides
  between them; `.action-row.archived` / `.action-row.selected` are (0,2,0) and win, which
  is what 425-431 says. `.session-state.running` no longer appears in the success rule
  (round 23 item 6 landed), `.session-state.sending` has no rail by design and the
  comment says so truthfully, and `.action-row.unread` (unconditional,
  `SessionList.ts:405`) paints only text weight, never the rail.
- **The arbiter's single-mark guarantee holds** in the session vocabulary, including
  error+unread (purple wins, and the reason at `sessionRowIndicator.ts:26-32` matches the
  code), and the dot colours match the rail colours one-for-one across the six kinds.
- **Machine-scoped stale state.** `interruptedSessionIds` is blanked across a machine
  switch at `:3979`; `refreshInterruptedRuns` drops stale arrivals before touching state;
  the runtime and health refreshes share the selection guard. (`interruptedRunsUnknown` is
  the one flag in this path with no such gate — folded into F1.)
