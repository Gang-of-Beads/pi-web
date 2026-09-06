---
"pi-web": minor
---

Workspace files become a bundled plugin. The tree, viewer, uploads, and file deep links move out of core into `pi-web-plugins/files`, driven by new plugin seams: `files.previewUrl`, `files.uploadFiles` with progress and cancel, `files.limits`, `files.uploadFolder`, `ui.renderMarkdownHtml`, `ui.textStyles`, `ui.registerModal`, `ui.query`, and the `session-activity-settled` lifecycle event. Every existing file URL, saved machine-navigation snapshot, and shared file link keeps working: the panel answers to the `files` and `core:workspace.files` route values and keeps the `core.workspace.files--file` and `--mode` deep-link namespaces.
