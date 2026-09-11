var meta = { name: 'goal_round_f_layout', description: 'Goal convergence Round F (final verification after the E fix wave): three glm lanes audit layout coordination (alignment, whitespace rhythm, button boundaries, centering, balance) on the live 8505 stack' };

var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, branch refactor/plugin-architecture. A live dev stack runs at http://localhost:8505/ - use it; do NOT restart it; do NOT modify repo files (probe scripts and screenshots go to /tmp only).',
  'The app is in "pro native" style: monospace UI face, near-black space-gray palette (#0b0d10 base, lightness-stepped surfaces), square corners 0-4px, flat (no shadows), hairline borders. Goal: layout COORDINATION convergence. This is Round F - verifying the Round E fix wave (commit b2f826b5): the goals refresh hover regression (extra brace removed), and the bare-small family on the type scale (ChatView custom-card, palette option descriptions, shared list footers, autocomplete descriptions all at --pi-text-2xs). VERIFY those reached the reader, then the full clean sweep. The bar: ZERO new TRUE findings beyond the owner-deferred ledger (docs/design/review-triage-goal-round-b.md, now including the leading-ramp item E-2). A single new TRUE means the loop continues.',
  '',
  'THE OWNER\'S FOUR COMPLAINTS (hunt these first):',
  '1. Alignment: things feel not-aligned across and within surfaces.',
  '2. Whitespace: some places extremely loose ("极度宽松" - e.g. the phone sessions heading row spreads [Sessions] [checkbox] [Clean up] [+ New session] with huge uneven gaps), others tight - no rhythm.',
  '3. Button boundaries: barely visible in the flat style - which buttons read as buttons? (settings form buttons, toolbar buttons, chips).',
  '4. The round fold button at the phone top-right reads harsh: it touches the top edge and the bottom border line with no breathing room, and a circle among squares is jarring (AppNavigationPanel compact header area).',
  'NEW: "New session" - check centering of titles/empty states on every surface (phone + desktop), margins, responsive behaviour at 393/768/1280, and general aesthetic balance.',
  '',
  'HOW TO BROWSE: node + playwright (installed in the repo; run node with cwd = the repo root, scripts in /tmp only). Phone: viewport 393x850, hasTouch, isMobile. Desktop: 1280x850. The app is shadow-DOM heavy - pierce via page.locator("pi-web-app").locator(...) or evaluate. Measure, do not guess: for spacing/alignment findings, read computed styles and bounding rects via evaluate and give the numbers.',
  '',
  'Every finding: file:line of the owning style, the two surfaces or elements compared (or the one element + its container), measured numbers, screenshot path (/tmp/roundf-*.png), and an explicit TRUE/FALSE adjudication. If a hunt item is clean, say so with the measurement that proves it.',
].join('\n');

var laneA = runs.run('lane-a', {
  agent: 'design-reviewer-d', timeoutMs: 5400000, label: 'roundA glm A phone', output: '/tmp/roundf-lane-a.md',
  task: CONTEXT + '\n\nYOUR FOCUS: the phone (393x850 coarse) end to end. Walk every surface (projects grid, workspaces, sessions drawer, chat, the six tool panels, context sheet, quick switcher, settings incl. Appearance, actions palette, row menus) and judge alignment, whitespace rhythm, centering (titles, empty states), button boundary visibility, and the round fold button. Measure gaps and paddings; compare sibling surfaces.',
});
var laneB = runs.run('lane-b', {
  agent: 'design-reviewer-e', timeoutMs: 5400000, label: 'roundA glm B desktop+responsive', output: '/tmp/roundf-lane-b.md',
  task: CONTEXT + '\n\nYOUR FOCUS: desktop (1280) plus the responsive breakpoints (393 / 768 / 1024 / 1280 - resize and compare the same surface across widths). Hunt misalignment, uneven margins/padding between sibling surfaces, centering of titles and empty states, button boundary visibility, and elements that jump size or position between breakpoints. Measure; give numbers and file:line.',
});
var laneC = runs.run('lane-c', {
  agent: 'qwen-parity-reviewer', model: 'botim-bllm/glm-5.3-flash', timeoutMs: 5400000, label: 'roundf glm C tokens+balance', output: '/tmp/roundf-lane-c.md',
  task: CONTEXT + '\n\nYOUR FOCUS: the token and pattern layer. Read the published scales (index.html tokens, spacing/type/radius/token guard tests) and audit ACTUAL usage against them across all components (shared.ts, appShell/*, ChatView, SessionList, the six plugin panels): paddings/gaps that bypass the spacing scale, type sizes outside the scale, radius inconsistencies (square language vs surviving pills/rounds incl. the phone fold button), borders that vanish on the flat theme, and spacing values that repeat with no token. This is where "extremely loose in places" comes from - find the unowned values.',
});
var results = await Promise.all([
  laneA.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneB.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneC.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
]);
return results.map(function (r, i) { return { lane: ['A', 'B', 'C'][i], ok: r !== null && !('failed' in Object(r)) }; });
