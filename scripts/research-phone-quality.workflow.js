const CONTEXT = [
  'PI WEB is a phone-first web UI for the pi coding agent. The owner just called the UI quality and',
  'layout "very poor" on a 393x850 Android phone, with two screenshots: the settings list and the',
  'boot/sessions screen. This is a READ-ONLY research task. Do not modify any file in the repository.',
  'Write your findings to your output file only.',
  '',
  'Measured facts from the running build (393x850, coarse pointer, taken by the owner\'s agent):',
  '  - Settings list rows: 59px tall, title 17px/600, sub-line 13px, left inset 16px, full-bleed',
  '    separators, no card; the section eyebrow above sits at 12px inset.',
  '  - Boot/sessions: three stacked chrome rows plus a search field consume about 180px of an 850px',
  '    screen before the first tile: context bar 45px, compact header 45px, "Projects + Add project"',
  '    row, then a 44px search input.',
  '  - Reading edges differ across the same screen: 10, 12, 15, 16 and 25px.',
  '  - Type on one screen: 11px path, 12px action label, 13px scope name, 14px body, 16px search,',
  '    17px settings title.',
  '  - Project tiles: two columns at 177px each, now clamped to one height (85px).',
  '',
  'Relevant source (read, do not edit): src/client/index.html (token block), ',
  'src/client/src/components/shared.ts (list and tile chrome), ',
  'src/client/src/components/SettingsDialog.ts, src/client/src/components/appShell/*.ts, ',
  'docs/design/minimal-layout-research.md, docs/design/mobile-layout-research.md, ',
  'docs/design/industry-layout-research.md (previous rounds of this same question).',
].join('\n');

const laneReference = () => runs.run('layout-reference', {
  agent: 'researcher',
  timeoutMs: 5400000,
  label: 'phone layout references',
  output: '/tmp/quality-reference.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: web research on what actually makes a phone-first list/settings UI feel considered.',
    'Search current material (2024-2026) from sources that publish measured guidance rather than',
    'opinion: Material 3 list and settings specs, Apple HIG lists and tables, GitHub Primer, Shopify',
    'Polaris, Atlassian, Linear/Vercel/Raycast writeups on density and type scales, and any credible',
    'research on list density, minimum comfortable line length and type ramps on 390-430px screens.',
    'Answer concretely, with citations: what row height and type sizes do these systems use for a',
    'two-line list row on a phone; how many distinct type sizes belong on one screen; when do they use',
    'a grouped card list versus full-bleed rows; how much chrome is acceptable above content; and how',
    'do they treat a secondary line such as a filesystem path. Give numbers we can adopt, and say',
    'where our current values (above) sit against them - too large, too small, or fine.',
  ].join('\n'),
});

const laneCritique = () => runs.run('layout-critique', {
  agent: 'design-reviewer-d',
  timeoutMs: 5400000,
  label: 'layout critique',
  output: '/tmp/quality-critique.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: read-only critique of our own layout system, from the source.',
    'Do not propose pixel tweaks. Name the structural decisions that produce the felt quality problem:',
    'the type ramp actually in use per surface, the reading edges, the chrome stack above content, the',
    'density of the settings list against the density of everything else, where a card would carry',
    'grouping and where full-bleed rows would, and which of these are set in tokens versus invented',
    'per component. Quantify each claim with file:line and, where you can, the computed value. Finish',
    'with the three changes that would raise perceived quality most per unit of risk, and say what',
    'each would break.',
  ].join('\n'),
});

const laneParity = () => runs.run('layout-parity', {
  agent: 'qwen-parity-reviewer',
  timeoutMs: 5400000,
  label: 'surface parity',
  output: '/tmp/quality-parity.md',
  task: [
    CONTEXT,
    '',
    'YOUR LANE: read-only parity census across every phone surface.',
    'For each of boot, sessions, chat, chat-drawer, settings, settings detail panels, context sheet,',
    'quick switcher, model picker, thinking picker and the add-project dialog, record from the source:',
    'the left reading edge, the row or item height, every distinct font-size and weight, the vertical',
    'rhythm between blocks, and whether the surface is card-grouped or full-bleed. Present it as one',
    'table so the disagreements are visible at a glance, then list the specific inconsistencies worth',
    'fixing in order of how visible they are on a phone. Cite file:line for every value.',
  ].join('\n'),
});

const results = await Promise.all([laneReference(), laneCritique(), laneParity()]);
return {
  lanes: results.map((value, index) => ({ lane: index + 1, ok: value !== null })),
  files: ['/tmp/quality-reference.md', '/tmp/quality-critique.md', '/tmp/quality-parity.md'],
};
