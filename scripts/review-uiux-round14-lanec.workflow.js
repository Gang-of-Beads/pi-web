const REPO = '/Users/hanxiao.du/Desktop/vincent/projects/pi-web';
const FIXED = [
  'ROUND THIRTEEN fixes: activity dock state dot at full strength (idle 2.18 / asking 2.42 / error 2.37 were under the 3:1 graphic floor); list rows read --pi-row-min-height; extension dialog controls box-sized (60px drawn for a declared 44); cleanup day field rises with its buttons; rail header icon buttons equal width',
  'listStyles small really wraps now (the previous fix was a no-op: the rule still ended in nowrap); add-machine inputs win against the host sheet (declared 16px mono, rendered 12px UI); tool cards and delivery receipts draw their marks, double tick no longer squeezed with negative letter-spacing',
  'composer trigger hint and collapsed draft off --pi-dim (measured ~2.6:1); row overflow menus paint alike; dead status-bar rules removed; --pi-chat-gutter base reads the spacing scale; audit script now fails when the stack serves a build other than the one on disk',
  'ROUND TWELVE fixes: transcript and status bar marks come from one uiIcons module (copy/resend/recall/tick/cross/run/up/down were typed characters); bulk-selection tick sized 16px instead of filling its control; dead shell chrome rules removed',
  'status words carry hue on a mark and text in body colour (success 3.97 / warning 3.80 / accent 3.50 measured on the raised card at 11px); picker detail text steps up on selection tints',
  'context sheet sticky header on the sheet ground; cleanup coarse floor no longer shadowed by a class rule; add-machine buttons use the app font; single-line dialog fields one height; rename field 16px so iOS does not zoom',
  'ROUND ELEVEN fixes: activity dock styles the class the renderer emits (working, not active); add-project footer and other cross-rule floors box-sized, and boxModelGuard now reads a floor and a padding declared for one selector in two rules',
  'picker search fields and close controls take one height and the app font; quick switcher reserves a menu column only where a menu renders; theme selection survives being active; main chip out of the two-line clamp',
  'context bar dead declaration removed (phone chrome rows read from one edge); transcript and settings hints back on the type scale; row menu ellipsis one size; workspace panel and file tree rows meet the control floor; jump-to-bottom, back verb, pinned and the info mark are drawn, not typed',
  'ROUND TEN fixes: the shell chevron is offered through the plugin host and six lists borrow it (machines/projects/workspaces/files/git/session tree); self-update banner adopts the state-dot styles it never had; one --pi-row-min-height for list rows; dialog closes all at comfort size',
  'machine offline reads the same in all three surfaces (mark plus word); Actions pill keeps its min-content floor; row overflow menus share ground and corner; context sheet title outranks inner sticky search; extension dialog is one card colour',
  'secondary copy steps up on selection tints (measured 4.42 to 7.27); dictation, prompt history, bulk selection and settings drill-in draw icons instead of text glyphs; quick switcher state mark accounts for its containing block',
  'ROUND NINE fixes: boxModelGuard now covers control floors (min-height + padding on a content box; the boot primary button declared 44 and drew 62); new pointerQueryOrder guard (a coarse floor written before a base rule with the same selector never applied; row menus measured 36 on a phone)',
  'hover and keyboard cursor use two channels in every picker; Appearance/Machines settings panels use the frame heading; shared disclosure chevron replaces text arrows; resident bar keeps 45px while working; context sheet sticky header spans the sheet',
  'settings fields land on the control scale; theme preview draws its declared height with centred dots; machine rows state status as mark-and-word with offline distinct; app focus ring restored in two settings panels; conversation meter halo restored',
  'ROUND EIGHT fixes: new boxModelGuard (a rule stating width, height and a visible border must state box-sizing; forty rules given one); spacing guard now reads offsets (top/right/bottom/left/inset), thirty-three literals became steps, between-step trims named in the guard',
  'one --pi-chrome-inset for stacked chrome rows (phone measured 6/6/6, was 10/8/6); context sheet header sticky; quick switcher close joins the comfort/touch family; panel edge control reads the touch height; compact row sets its corner language for controls that render themselves',
  'ModalSurface shell has an accent focus ring (was the platform blue); model picker catalogue rows state type and touch floor; add-project touch floors keyed to pointer not viewport; row-list activity dot shares the row menu centre line; ask-user and prompt-enter checkbox rows centre their 24px box; search hints and tree markers off --pi-dim',
  'ROUND SEVEN fixes: seven dialog/picker close controls are border-box (token said 32, box drew 34); chat drawer header 52 to 45 (padding was outside the control); orphan marker off --pi-dim at 0.65 (~2.3:1); bulk toolbar and row menus meet their floors; resident bar rule weight and 20px toggle icon aligned with the header set',
  'settingsControlStyles: nine settings panels adopt one control scale and coarse floor (General shipped 40/42/35px in one screen); add-project sizes checkbox, field and footer on a mouse too; model picker scope control at comfort height',
  'context sheet keeps the Machines and Workspaces headings: the phone rule that hides a word-only heading now asks its surface (correct in the panel, wrong in a sheet stacking three lists)',
  'ROUND SIX fixes: interrupted ring is border-box (drew 12px, off-centre 2px); ask-user card header shares its content column and its custom-answer indent is derived; native inputs take the checkbox token; machine row menu 32px on a mouse',
  'phone panel header is 45px like the rail and resident bar (was 53); informational text moved off --pi-dim (4.12:1) to --pi-muted; load-earlier and empty-transcript controls meet their floors; drawer header shares the body gutter; msg-meta is 24px square with the same hit expansion as its siblings',
  'session row leading gutter is one formula (--pi-row-gutter-start/-size) instead of five literals; tile activity dot derives its offset from --pi-dot-md (was a stale 5px radius, 1px off); error banner dismiss is a square control; add-project footer uses the app font; a dead block of list rules was removed from the composer',
  'ROUND FIVE fixes: context sheet no longer squeezes its lists (a second machine was an 8.9px sliver) and no longer prints Machines twice; msg-meta readable at rest (was 1.37:1); chat drawer body has a gutter; auth dialog has a coarse floor; weights and disabled opacity are guarded, not swept',
  'AUDIT-DRIVEN fixes after round five: a picker opened from the settings dialog declares a layer above it (it used to paint under the dialog while holding focus and Escape); rail header and resident context bar share one height (45 vs 53 before); coarse touch expansion clears the info control (2px overlap before); context switcher chip and add share one font; theme preview corners derived so nested arcs stay parallel',
  'GUARD: controlHeightScale reads declarations, not comments',
  'ROUND FOUR fixes: activity dock asking/error used undefined tokens (fixed); panel header title truncates; banner buttons on the touch floor; multi-select indent derived from the checkbox; one count badge, one dismiss glyph, one header icon size, one banner edge',
  'NEW GUARD tokenReferences.test.ts: a var(--pi-*) with no definition and no fallback fails CI (three such defects had shipped)',
  'quick switcher renders its row mark through the sessionRowIndicator arbiter (was an accent dot over the purple unread dot); its rows and footer state their own type',
  'dialog close controls agree on a mouse size; msg-meta and the disabled remedy line are readable (were 2.55:1 and 2.14:1); user role label no longer 3.93:1; theme cards clamp both variable lines; disabled is --pi-disabled-opacity',
  '--pi-checkbox-size, --pi-weight-strong, --pi-elevation-*, focus-ring offset tokens and mono stacks all in use; settings detail close aligned; workspace main is a tag',
  'JUDGED NOT TRUE (do not re-report): --pi-muted below AA - measured 5.56:1 live, 4.71:1 against the card stop; the lane figure multiplied an ancestor opacity chain into the comparison',
  'ROUND THREE fixes: guards now read inside calc()/max(), negative offsets, font: shorthands and outline widths; 75 hidden spacing values, 46 font shorthands, 18 ring widths tokenized',
  '--pi-weight-strong (650) and --pi-elevation-* named; 50 weights and 10 shadows read them',
  'panel-header token equals the control height it contains (rail and drawer share one rule); cleanup entry keeps the mouse control height; multi-select checkbox concentric with the subtree toggle on both pointer types',
  'resident bar name truncates with an ellipsis; idle activity dock is quiet through colour not a 0.75 opacity layer (was 3.96:1); clear-queue pill meets the control height; settings and cleanup dialogs close with the same control',
  'failed command receipt uses --pi-danger (it named three tokens that do not exist); add-project hints wrap so the project-trust link is on screen; settings back control has no surface fill',
  'picker close controls sized on both pointer types; picker option descriptions read the type scale; theme preview dot on the dot scale; tile activity dot in its reserved slot; error banner dismiss meets the control height; control sizes inside custom properties face the control-height guard',
  'ROUND TWO fixes: inert subtree toggle no longer covers the row checkbox; cleanup entry meets the control height; cleanup dialog and ask-user card raise controls by pointer type; add-project/add-machine confirms use the accent fill; unread count is a badge; both lightboxes close at one size; + glyph one size; chip label on the type scale',
  '--pi-on-accent: themes name the label colour on an accent fill (dark theme was 3.74:1); nine accent-filled controls read it',
  'picker rows state their own type (no more UA Arial 13.3px, no more 1px taller check-marked row); small reads the type scale; row menus outside tiles get the coarse floor; msg-meta draws the app focus ring',
  'session row state mark is positioned (no longer a whole extra line); appearance cards clamp descriptions; follow-the-system checkbox stays square; quick switcher group headings align with cards; thinking picker max has a description',
  'TYPE SCALE mechanical: every font-size reads --pi-text-*; typeScale.test.ts guards it',
  'SPACING SCALE mechanical: every rhythm-sized padding/margin/gap reads --pi-space-*; spacingScale.test.ts guards it',
  'undefined tokens --pi-text-muted / --pi-accent-contrast / --pi-bg-raised (all replaced)',
  'focus-visible no longer inherits the parent border-radius',
  'message-row action hit boxes no longer overlap',
  'session rename dialog now styled like its sibling dialogs',
  'quick switcher: single derived menu-size reserve, one toggle rule, state mark moved out of the toggle box, rename actions on the touch floor',
  'tile activity dot shares the menu button centre line',
  'machine dialog + machine row menu got coarse-pointer floors; add-project footer keyed to pointer type',
  'model/command picker focus rings restored; ModelPicker search box-sizing fixed',
  'refresh control matches the header control height; settings gear is an SVG icon',
  'drawer tab count is a badge; appearance panel marks the live theme; composer toolbar has one height',
  'RADIUS SCALE: every border-radius reads --pi-radius-*; radiusScale.test.ts fails on a pixel literal',
  'CONTROL HEIGHT SCALE: --pi-control-height (32) / -comfort (36) / -touch (44); controlHeightScale.test.ts fails on a control-sized literal',
  'DOT SCALE: --pi-dot-xs|sm|md; dotScale.test.ts fails on a sixth size',
];
const KNOWN_OPEN = [
  'modal layer inversion: pickers claim --pi-layer-popover (30) under dialogs at 50 while the modal registry promotes them (product/architecture decision, deliberately unfixed)',
  '"current value" in pickers is prose appended to the label while .selected marks the keyboard cursor (owner product semantics, deliberately unfixed)',
  'drawer tab min-height 22px is deliberate and pinned by composerRoom.test.ts (judged not true)',
];

const SURFACES = 'boot; sessions; chat; chat-drawer; msg-row-menu; model-picker; thinking-picker; settings; settings-appearance; quick-switcher; qs-row-menu; context-sheet; add-project-dialog';

const lanePrompt = (focus, files, surfaces, out) => [
  'You are one lane of ROUND FOURTEEN of a visual-polish convergence audit of the PI WEB client (Lit web app).',
  'Repo: ' + REPO + ' (branch refactor/plugin-architecture, current HEAD). Client source: src/client/src/, plugin surfaces: pi-web-plugins/.',
  'Round one fixed these; do NOT re-report them, verify them if you like: ' + FIXED.join(' | '),
  'These are known and deliberately open; do NOT report them: ' + KNOWN_OPEN.join(' | '),
  'The 13 audited surfaces: ' + SURFACES,
  'Your lane focus: ' + focus,
  'Primary files: ' + files,
  'Focus surfaces: ' + surfaces,
  'Hunt ONLY for NEW findings in: geometric centring of icons/glyphs in their controls; alignment of icon+text rows; sibling controls of unequal height or padding; spacing rhythm breaks; scale escapes (a value that should read a token but does not, in radius, control height, dot size, spacing or type size); bare text carrying UI state where a mark is the house pattern; contrast below AA on a filled control.',
  'Method: read the real source and cite file:line you verified. A finding without a verified line number is worthless. Say TOTAL: 0 findings if the lane finds nothing - a clean lane is the goal, not a failure.',
  'Format per finding: ## F<n> title / - file:line / - surface / - finding (state it geometrically) / - minimal failure scenario / - confidence.',
  'Write the report with your bash tool (no heredocs; use printf or python3 -c) to: ' + out,
  'End your reply with DONE.',
].join('\n\n');

const laneC = () => runs.run('r14-lane-c', {
  agent: 'design-reviewer-d', timeoutMs: 5400000,
  label: 'opus full round7',
  task: lanePrompt(
    'a full pass over all 13 surfaces with a polish lens, including live measurement against the running stack at http://127.0.0.1:8505 if you can drive @playwright/test (chromium is installed); prefer measured evidence over inference',
    'src/client/src/components (whole tree), pi-web-plugins (browser surfaces)',
    SURFACES,
    '/tmp/uiux-r14-lane-c.md'
  ),
  output: '/tmp/uiux-r14-lane-c.md'
});

const results = await Promise.all([laneC()]);
return { lanes: [{ lane: 3, ok: results[0] !== null }], files: ["/tmp/uiux-r14-lane-c.md"] };
