---
"@gang-of-beads/pi-web": patch
---

A browser plugin that registers an element through a side-effect import (`import "./element.js"`) now loads. The plugin build only followed `import … from` when deciding whether an entry reaches a package and must be bundled, so such an entry shipped with a bare `lit` import the browser could not resolve and the whole plugin silently never activated; the shipped-entry guard had the same blind spot and now walks every import form through the whole graph.
