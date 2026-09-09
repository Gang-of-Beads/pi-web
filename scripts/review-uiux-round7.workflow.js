const REPO = '/Users/hanxiao.du/Desktop/vincent/projects/pi-web';
const FIXED = [
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
  'You are one lane of ROUND SEVEN of a visual-polish convergence audit of the PI WEB client (Lit web app).',
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

const laneA = () => runs.run('r7-lane-a', {
  agent: 'design-reviewer-d',
  label: 'glm shell round2',
  task: lanePrompt(
    'app shell and chrome geometry after the scale work',
    'src/client/src/components/appShell/*.ts, src/client/src/components/SessionList.ts, src/client/src/components/StatusBar.ts, src/client/src/components/ChatView.ts, src/client/src/components/shared.ts, src/client/index.html (token block)',
    'boot; sessions; chat; chat-drawer; context-sheet',
    '/tmp/uiux-r7-lane-a.md'
  ),
  output: '/tmp/uiux-r7-lane-a.md'
});
const laneB = () => runs.run('r7-lane-b', {
  agent: 'qwen-parity-reviewer',
  label: 'qwen overlays round2',
  task: lanePrompt(
    'pickers, dialogs and sheets after the scale work',
    'src/client/src/components/{ModelPicker,CommandPicker,QuickSwitcher,SettingsDialog,SessionRenameDialog,SessionCleanupDialog,AskUserCard,ExtensionDialogCard,ModalSurface}.ts, src/client/src/components/settings/*.ts, pi-web-plugins/workspaces/browser/ProjectDialog.ts, pi-web-plugins/machines/browser/*.ts',
    'model-picker; thinking-picker; settings; settings-appearance; quick-switcher; qs-row-menu; add-project-dialog',
    '/tmp/uiux-r7-lane-b.md'
  ),
  output: '/tmp/uiux-r7-lane-b.md'
});
const laneC = () => runs.run('r7-lane-c', {
  agent: 'opus-design-reviewer-b', timeoutMs: 5400000,
  label: 'opus full round7',
  task: lanePrompt(
    'a full pass over all 13 surfaces with a polish lens, including live measurement against the running stack at http://127.0.0.1:8505 if you can drive @playwright/test (chromium is installed); prefer measured evidence over inference',
    'src/client/src/components (whole tree), pi-web-plugins (browser surfaces)',
    SURFACES,
    '/tmp/uiux-r7-lane-c.md'
  ),
  output: '/tmp/uiux-r7-lane-c.md'
});

const results = await Promise.all([laneA(), laneB(), laneC()].map(p => p.catch(e => ({ error: String(e) }))));
return { lanes: results.map((r, i) => ({ lane: i + 1, ok: !(r && r.error), error: r && r.error ? r.error : undefined })), files: ['/tmp/uiux-r7-lane-a.md', '/tmp/uiux-r7-lane-b.md', '/tmp/uiux-r7-lane-c.md'] };
