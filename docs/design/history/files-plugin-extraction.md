# Files plugin extraction

Owner call: the file-panel code is too scattered — build the files plugin.
This records the design before the code: what moves, what the seams are, and
which user-facing contracts must survive byte-for-byte.

## What "scattered" means today

The files domain spans eleven core files plus host wiring:

- Components: `WorkspaceFilesPanel.ts` (515), `WorkspaceFileViewer.ts` (455),
  `CodeViewer.ts` (129), `filesSplitLayout.ts` (11).
- State machines: `controllers/fileExplorerController.ts` (288, tree + URL +
  upload orchestration), `workspaceUploadState.ts` (179), 
  `workspaceFileViewMode.ts` (101).
- Transport: `api/workspaceUploads.ts` (352, XHR upload with progress),
  `api/urls.ts` `workspaceFilePreviewUrl`, `plugins/workspaceFiles.ts`.
- Vocabulary: `formatting/workspaceMarkdown.ts`, `utils/format.ts`
  `formatFileSize`, `shared/workspaceFiles.ts` preview limits.
- Host wiring: `appState.ts` file-tree fields, `PiWebApp.ts`
  `createWorkspacePanelContext` files callbacks + refresh/restore flows,
  `plugins/types.ts` internal context extras, `plugins/core/panels.ts`
  (`workspace.files` contribution).

The panel element itself owns no data: it renders `context.fileTree` and
calls `onSelectFile`-style callbacks the host assembles. The state lives in
the host, the UI in components, the transport in api/, the vocabulary in
formatting/ — five homes for one feature.

## Design: the plugin owns the whole files experience

New bundled plugin `pi-web-plugins/files/` (built by `tsconfig.plugins.json`
+ `build-plugins.mjs`, discovered automatically from `dist/pi-web-plugins`).
It owns the explorer state machine, the tree, the viewer, the upload UX, the
view-mode persistence, and the URL deep links. The host keeps only the
server endpoints and the seam.

### Seam additions (public plugin API)

1. `WorkspaceFiles.previewUrl(path, options?: {modifiedAt?, download?})` —
   host-owned URL building (the resolveAppUrl rules stay core).
2. `WorkspaceFiles.limits` — `{inlinePreviewBytes, streamPreviewBytes}`, the
   file endpoint's thresholds the viewer's inline-vs-stream decision needs.
   Size labels stay plugin-side presentation.
3. `WorkspaceFiles.uploadFiles(inputs, options)` — the XHR upload with
   per-file and batch progress plus cancel, today's
   `uploadWorkspaceFiles` behind the seam. Progress types move into
   `pluginApiTypes`; the plugin owns the batch UI machine over it.
4. `PluginHostUi.renderMarkdownHtml(markdown)` — sanitized markdown HTML,
   host-owned vocabulary.
5. `PluginHostUi.registerModal(registration)` — the layer registry behind a
   seam so a plugin dialog gets the same isTop/focus/inert coordination as
   built-in dialogs.
6. `PluginHostUi.query` — `read(namespace, key)` / `write(namespace, key,
   value, options?)`, the namespaced-query seam so plugin panels can hold
   deep-linkable state without spelling URLs.

### Compat contracts (must survive)

- Qualified id `core:workspace.files` is wire format: the appState default
  tool, saved machine-navigation snapshots, the `?tool=` URL value, and the
  `core.workspace.files--file` / `--mode` deep-link namespaces. The plugin
  contribution takes id `files` with `routeAliases: ["files",
  "core:workspace.files"]` and its query namespace stays
  `core.workspace.files`, so every existing URL, saved snapshot, and shared
  file link keeps resolving.
- Core action "Go to files" (mod+2) selects the same route value; alias
  resolution + the first-panel fallback keep it landing on the files panel.
- The panel keeps order 10 so it stays the default workspace tool.
- Upload defaults (`.pi-web/uploads`, create dirs on, overwrite off, direct
  drop uploads) and the review dialog flow are unchanged.
- View-mode default raw, deep-link adoption, device preference key, and the
  raw/preview URL publication are unchanged.

### Moves

Into the plugin: four components (as `filesPanelElement`, `fileViewerElement`,
`codeViewerElement`, `filesSplitLayout`), the explorer state machine
(rewritten against `context.files` instead of global appState), the upload
batch state machine, the view-mode store, a local `formatFileSize`.

Stays core: the file endpoints and `api/workspaceUploads` XHR machinery
(host infra behind the seam), `workspaceMarkdown` (exposed via ui), the
modal registry and namespaced-query implementation (exposed via ui).

Deleted from core: `plugins/core/panels.ts`, the internal
`WorkspacePanelContext` files fields, the appState file-tree fields and
reducer cases, `fileExplorerController.ts`, `workspaceUploadState.ts`,
`workspaceFileViewMode.ts`, the four component files and their tests (moved),
PiWebApp's files wiring (`this.files`, refresh/restore flows,
`workspaceUploadDefaultFolder`). `refreshFiles` on the plugin runtime context
re-points to invalidating the files panel.

## Verification

Vitest moves with the code; the plugin's tests exercise the machine against
fake `context.files`/`ui` seams. Then `npm run verify`, the 8505 rebuild, and
a live probe: Files tab renders the tree, expand/select loads a file, preview
and raw modes work, the upload review dialog opens, `?tool=files` and
`?tool=core:workspace.files` both land on the panel, and a deep link with a
selected file restores it.
