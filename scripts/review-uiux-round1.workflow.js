const REPO = '/Users/hanxiao.du/Desktop/vincent/projects/pi-web';
const SURFACES = [
  'boot (fresh app load, project grid)',
  'sessions (projects -> session list)',
  'chat (session transcript)',
  'chat-drawer (session drawer tabs/sections)',
  'msg-row-menu (message row action menu)',
  'model-picker (model picker dialog)',
  'thinking-picker (thinking level picker)',
  'settings (settings dialog)',
  'settings-appearance (appearance panel)',
  'quick-switcher (quick switcher overlay)',
  'qs-row-menu (quick switcher row menu)',
  'context-sheet (context switcher sheet)',
  'add-project-dialog (add project dialog)'
];
const HUNT = [
  'icons/glyphs not geometrically centered in their buttons/badges (raw text glyphs, missing place-items, baseline drift)',
  'mixed icon+text rows misaligned (icon baseline vs label, badge vertical centering)',
  'inconsistent control heights across sibling controls (44 vs 36 vs 34 vs 28 mixed without a token)',
  'padding/margin drift between sibling rows, cards, dialogs (same pattern, different numbers)',
  'border-radius mismatches within one surface family (e.g. 8 vs 12 vs pill on sibling elements)',
  'text truncation/clamp inconsistencies between sibling list rows',
  'visually unstyled bare text where a styled state is required (plain <p>/<span> carrying UI meaning)'
];
const FORMAT = [
  'Output a markdown report with one section per finding:',
  '## F<n> <short title>',
  '- file:line (exact, read the real source; cite the line you verified)',
  '- surface: <which of the 13 surfaces>',
  '- finding: <what is visually wrong, geometrically stated>',
  '- minimal failure scenario: <the smallest user-visible symptom>',
  '- confidence: high|medium|low',
  'End with a line: TOTAL: <n> findings.',
  'Do not report functional bugs, only visual-geometry/coordination issues. Do not invent file:line - open the file and verify the line number. Aim for precision over volume; a wrong finding costs more than a missed one.'
];

const lanePrompt = (name, focus, files, surfaces, out) => [
  'You are one lane of a multi-lane visual-polish audit of the PI WEB client (a Lit web app).',
  'Repo: ' + REPO + ' (branch refactor/plugin-architecture). Client source: src/client/src/.',
  'The app ships 13 audited surfaces: ' + SURFACES.join('; ') + '.',
  'Your lane focus: ' + focus,
  'Primary files to inspect (start here, follow imports as needed): ' + files,
  'Focus surfaces for your lane: ' + surfaces,
  'Hunt list: ' + HUNT.join(' | '),
  FORMAT.join('\n'),
  'IMPORTANT: verify every file:line by reading the file. Write your finished report with your bash tool (single mkdir -p + cat redirect is forbidden; use a here-doc free method such as: printf "%s\\n" lines > file, or python3 -c) to: ' + out,
  'Then end your reply with the single word DONE.',
].join('\n\n');

const laneA = () => runs.run('lane-a-glm-shell', {
  agent: 'design-reviewer-d',
  label: 'glm shell lanes',
  task: lanePrompt(
    'Lane A (glm, shell + chrome)',
    'app shell and chrome geometry: nav panel, headers, context bars, drawer chrome, status bar, session list rows, project/workspace cards',
    'src/client/src/components/appShell/AppNavigationPanel.ts, src/client/src/components/appShell/AppContextBar.ts, src/client/src/components/appShell/AppContextSwitcher.ts, src/client/src/components/appShell/ContextSwitcherSheet.ts, src/client/src/components/SessionList.ts, src/client/src/components/WorkspaceList.ts, src/client/src/components/StatusBar.ts, src/client/src/components/ChatView.ts (drawer/shell parts), src/client/src/components/shared.ts, src/client/src/components/designTokens',
    'boot; sessions; chat; chat-drawer; context-sheet',
    '/tmp/uiux-lane-a.md'
  ),
  output: '/tmp/uiux-lane-a.md'
});
const laneB = () => runs.run('lane-b-qwen-pickers', {
  agent: 'qwen-parity-reviewer',
  label: 'qwen picker lanes',
  task: lanePrompt(
    'Lane B (qwen, pickers + dialogs)',
    'pickers, dialogs, sheets and their rows: option rows, headers, action bars, search inputs, chips/badges inside overlays',
    'src/client/src/components/ModelPicker.ts, src/client/src/components/QuickSwitcher.ts, src/client/src/components/SettingsDialog.ts, src/client/src/components/settings/SettingsAppearancePanel.ts, src/client/src/components/ExtensionDialogCard.ts, src/client/src/components/SessionRenameDialog.ts, src/client/src/components/AskUserCard.ts, src/client/src/components/ToolExecutionView.ts, src/client/src/plugins (dialog-related), pi-web-plugins/workspaces/browser/addProjectDialog.ts',
    'model-picker; thinking-picker; settings; settings-appearance; quick-switcher; qs-row-menu; add-project-dialog',
    '/tmp/uiux-lane-b.md'
  ),
  output: '/tmp/uiux-lane-b.md'
});
const laneC = () => runs.run('lane-c-opus-full', {
  agent: 'fe-review-opus-b',
  label: 'opus full pass',
  task: lanePrompt(
    'Lane C (opus, details/polish/accessibility full pass)',
    'a full pass over all 13 surfaces with a polish lens: every button, badge, chip, input, and row checked for centering/alignment/height/spacing coordination, including raw text glyphs standing in for icons',
    'src/client/src/components (whole tree), src/client/src/components/appShell (whole tree), pi-web-plugins (browser surfaces: goals, files, workspaces, terminal, voice)',
    SURFACES.join('; '),
    '/tmp/uiux-lane-c.md'
  ),
  output: '/tmp/uiux-lane-c.md'
});

const results = await Promise.all([laneA(), laneB(), laneC()].map(p => p.catch(e => ({ error: String(e) }))));
const summaries = [];
for (let i = 0; i < results.length; i++) {
  const r = results[i];
  if (r && r.error) { summaries.push({ lane: i + 1, error: r.error }); continue; }
  let text = '';
  try {
    if (r && typeof r === 'object') {
      if (typeof r.output === 'string') text = r.output;
      else if (r.outputPath) text = 'wrote ' + r.outputPath;
    } else if (typeof r === 'string') text = r;
  } catch (e) { text = 'extract-failed: ' + String(e); }
  summaries.push({ lane: i + 1, text: text.slice(0, 400) });
}
return { lanes: summaries, note: 'full reports at /tmp/uiux-lane-a.md /tmp/uiux-lane-b.md /tmp/uiux-lane-c.md' };
