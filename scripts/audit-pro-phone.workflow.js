var meta = { name: 'pro_phone_surface_walk', description: 'Two glm lanes with Playwright: walk every mobile surface clicking and screenshotting for overlaps, and audit layout consistency of the pro look' };

var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web. A live dev stack is running at http://localhost:8505/ - use it, do not restart it, do not modify any repo file.',
  'The app just switched to a "pro native" look: monospace UI face, square corners (radius 0-4px), flat (no elevation), dark. The owner reports: on PHONE, tapping buttons makes many pages/surfaces overlap into a pile; and across the app many places are misaligned / incoherent / stylistically inconsistent.',
  '',
  'HOW TO BROWSE: node + playwright (installed in the repo). Write your probe scripts to /tmp ONLY (import playwright from the repo - run node with cwd /Users/hanxiao.du/Desktop/vincent/projects/pi-web, or import the absolute path node_modules/playwright). Emulate the phone: viewport 393x850, hasTouch: true, isMobile: true. The app is shadow-DOM heavy: use locators that pierce shadow roots (page.locator("pi-web-app").locator("...") pierces automatically; or hunt via evaluate). Surface names: the drawer button (hamburger / Sessions), drawer tabs (Files/Terminal/Tasks/Relays/Updates/Info), nav sections (Projects/Workspaces/Sessions), the context chips (Local/Project/Workspace + their pickers), the gear (Settings dialog with its own sections incl. Appearance with theme cards), Actions (command palette), quick switcher (mod+k or the search), the project rows and their "..." row menus, + buttons (Add project), and the Updates/Files panels.',
  '',
  'For EVERY surface: click it open, wait ~800ms, screenshot to /tmp/pro-walk-NN-<name>.png, and record: does it open at all; does anything overlap/stack into a pile (two pages drawn over each other, a panel over the drawer, a dialog over a dialog, text over text); does closing it work; does the surface after closing look like the boot state.',
  'Overlap evidence must name the two surfaces involved and the screenshot file.',
].join('\n');

var laneA = runs.run('lane-a', {
  agent: 'design-reviewer-d', timeoutMs: 5400000, label: 'prophone glm A walk', output: '/tmp/prophone-lane-a.md',
  task: CONTEXT + '\n\nYOUR FOCUS: the full click-walk. Open every surface listed above one at a time on the phone emulation, screenshot each, and hunt OVERLAPS - the owner says tapping buttons piles pages on top of each other. For each finding: the two surfaces, the click path that reproduces it, the screenshot path. Also verify every surface CLOSES cleanly back to boot.',
});
var laneB = runs.run('lane-b', {
  agent: 'design-reviewer-e', timeoutMs: 5400000, label: 'prophone glm B consistency', output: '/tmp/prophone-lane-b.md',
  task: CONTEXT + '\n\nYOUR FOCUS: layout consistency of the pro look across BOTH phone (393x850 coarse) and desktop (1280x850 fine). Screenshot side-by-side pairs of the same kind of surface (list rows, dialogs, toolbars, headers, chips, buttons) and hunt: misaligned baselines, inconsistent paddings between sibling surfaces, heading styles that differ between surfaces that should match, control heights that disagree, borders/radii that differ between siblings, text sizes outside the published scale. Every finding: file:line of the owning style, the two surfaces compared, screenshot path.',
});
var results = await Promise.all([
  laneA.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneB.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
]);
return results.map(function (r, i) { return { lane: ['A', 'B'][i], ok: r !== null && !('failed' in Object(r)) }; });
