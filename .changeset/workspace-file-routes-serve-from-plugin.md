---
"pi-web": patch
---

The workspace file family is now served by the bundled workspaces plugin's server half instead of core routes: tree, read, write, delete, move, preview, and suggestions ride the route-contribution seam with the same core-shaped paths, status codes, and preview policies, resolving workspace identity through the injected catalog port and path access through the injected config port. Route contributions can read text and binary request bodies, and the suggestions and file-content types the plugin serves are part of the published server contract.
