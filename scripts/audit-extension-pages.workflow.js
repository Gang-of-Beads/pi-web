var meta = { name: 'extension_pages_audit', description: 'Two glm lanes: inventory the page/view surfaces an extension can contribute today, then review that design for problems' };

var CONTEXT = [
  'PI WEB repo: /Users/hanxiao.du/Desktop/vincent/projects/pi-web, branch refactor/plugin-architecture.',
  'READ-ONLY: do not modify any repository file. Prefer read/grep/find over bash; never run long shell commands. Write only to your output path.',
  'Every claim needs file:line. Where you judge, give TRUE/FALSE with a minimal failure scenario or a concrete gap.',
  '',
  'QUESTION: can an extension (piWebPlugin) add its own PAGE today - a full-pane view the reader can navigate to, with its own URL/deep link - or only panels/sections/dialogs inside host-owned pages?',
  '',
  'Known surface map to verify and extend (do not trust it blindly - verify each with file:line, and find what it misses):',
  '- src/plugin-api.ts + src/shared/pluginApiTypes.ts + src/client/src/plugins/types.ts: the contribution vocabulary (themes, workspacePanels, navSections, machineSections, drawerSections, workspaceLabels, messageRenderers, composer contributions, dialogs, operations, agentSurfaces).',
  '- src/client/src/plugins/registry.ts: how contributions register, qualify (pluginId:localId), and reach the UI.',
  '- WorkspacePanel + workspacePanels: the closest thing to a page - how a panel is opened, whether it has a URL, whether state survives a reload (scripts/probe-*.mjs, WorkspacePanel.ts, lazySurfaces.ts).',
  '- Routing: src/client/src/appState.ts, navigationState/whereAmIBar/appShell, PiWebApp route parsing - which URL namespaces exist (project/workspace/session/machine params, TERMINAL_ROUTE_NAMESPACE etc.) and whether a plugin can claim any.',
  '- Server side: pi-web-plugins/*/server-plugin.ts, src/server/web/plugins/serverPluginRouteMount.ts, pluginOperationProxyRoutes.ts - extensions serve HTTP under /api/machines/... and /pi-web-plugins/...; do any of them render HTML pages?',
  '- The bundled plugins (pi-web-plugins/files, git, goals, updates, terminal, workspaces, machines) as the reference users: which surfaces each uses, and which one comes closest to needing a real page.',
  '',
  'Deliverable: a verdict on "can extensions add pages today", the verified surface inventory, and - for lane B only - a design review.',
].join('\n');

var laneA = runs.run('lane-a', {
  agent: 'design-reviewer-d', timeoutMs: 5400000, label: 'extpages glm A inventory', output: '/tmp/extpages-lane-a.md',
  task: CONTEXT + '\n\nYOUR FOCUS: inventory and mechanics - enumerate every surface an extension can contribute, how each renders, how each is reached (click? URL? deep link?), what state survives reload, and the exact answer to "can an extension add a page today". Verify the map above, extend it, correct it.',
});
var laneB = runs.run('lane-b', {
  agent: 'design-reviewer-e', timeoutMs: 5400000, label: 'extpages glm B design review', output: '/tmp/extpages-lane-b.md',
  task: CONTEXT + '\n\nYOUR FOCUS: design review - is the current page/panel story coherent? Where does it break (routing/deep links, lifecycle on machine/workspace switch, reload, permissions, focus)? What would a minimal honest "extension page" design look like given the existing contract (name the seams, do not write code)? Judge the workspacePanel-as-page compromise explicitly.',
});
var results = await Promise.all([
  laneA.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
  laneB.catch(function (error) { return { failed: String(error).slice(0, 200) }; }),
]);
return results.map(function (r, i) { return { lane: ['A', 'B'][i], ok: r !== null && !('failed' in Object(r)) }; });
