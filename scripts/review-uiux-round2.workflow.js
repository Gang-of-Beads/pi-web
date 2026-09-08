const REPO = '/Users/hanxiao.du/Desktop/vincent/projects/pi-web';
const FIXED = [
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
  'You are one lane of ROUND TWO of a visual-polish convergence audit of the PI WEB client (Lit web app).',
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

const laneA = () => runs.run('r2-lane-a', {
  agent: 'design-reviewer-d',
  label: 'glm shell round2',
  task: lanePrompt(
    'app shell and chrome geometry after the scale work',
    'src/client/src/components/appShell/*.ts, src/client/src/components/SessionList.ts, src/client/src/components/StatusBar.ts, src/client/src/components/ChatView.ts, src/client/src/components/shared.ts, src/client/index.html (token block)',
    'boot; sessions; chat; chat-drawer; context-sheet',
    '/tmp/uiux-r2-lane-a.md'
  ),
  output: '/tmp/uiux-r2-lane-a.md'
});
const laneB = () => runs.run('r2-lane-b', {
  agent: 'qwen-parity-reviewer',
  label: 'qwen overlays round2',
  task: lanePrompt(
    'pickers, dialogs and sheets after the scale work',
    'src/client/src/components/{ModelPicker,CommandPicker,QuickSwitcher,SettingsDialog,SessionRenameDialog,SessionCleanupDialog,AskUserCard,ExtensionDialogCard,ModalSurface}.ts, src/client/src/components/settings/*.ts, pi-web-plugins/workspaces/browser/ProjectDialog.ts, pi-web-plugins/machines/browser/*.ts',
    'model-picker; thinking-picker; settings; settings-appearance; quick-switcher; qs-row-menu; add-project-dialog',
    '/tmp/uiux-r2-lane-b.md'
  ),
  output: '/tmp/uiux-r2-lane-b.md'
});
const laneC = () => runs.run('r2-lane-c', {
  agent: 'fe-review-opus-b',
  label: 'opus full round2',
  task: lanePrompt(
    'a full pass over all 13 surfaces with a polish lens, including live measurement against the running stack at http://127.0.0.1:8505 if you can drive @playwright/test (chromium is installed); prefer measured evidence over inference',
    'src/client/src/components (whole tree), pi-web-plugins (browser surfaces)',
    SURFACES,
    '/tmp/uiux-r2-lane-c.md'
  ),
  output: '/tmp/uiux-r2-lane-c.md'
});

const results = await Promise.all([laneA(), laneB(), laneC()].map(p => p.catch(e => ({ error: String(e) }))));
return { lanes: results.map((r, i) => ({ lane: i + 1, ok: !(r && r.error), error: r && r.error ? r.error : undefined })), files: ['/tmp/uiux-r2-lane-a.md', '/tmp/uiux-r2-lane-b.md', '/tmp/uiux-r2-lane-c.md'] };
