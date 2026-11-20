---
"@gang-of-beads/pi-web": patch
---

Releasing now refuses a tag that disagrees with `package.json` in the core workflow too, as the plugin-API one already did, so a tag pushed on the wrong commit cannot publish and label a different version. Release jobs also pin every third-party action to a commit and no longer keep the git token in the checkout, and the plugin-authoring example says which surface and storage pi-goal 1.0 uses and that the bundled `goal` plugin supersedes the separate package.
