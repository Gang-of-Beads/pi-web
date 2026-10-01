# Review triage: P7 slice a, every browser plugin entry bundled into one module

Review run `79f47341`. Two lanes on `reviewer` read a frozen worktree at `bc062c40` and its built `dist/pi-web-plugins`. Opus 5.5: OK with notes. DeepSeek 4.1 flash max: OK with notes. Neither lane found a P0 or a P1. Both confirm that no plugin behaves differently once bundled:

- `import.meta.url` stays the entry's URL with its query (updates, mermaid).
- Mermaid's computed-URL engine stays lazy.
- No module is reachable from two entries.
- No server module is bundled.
- No library is newly duplicated.
- The revision query keeps the cache correct.

Each finding was checked against the source before triage.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| 1 | `pluginModuleSpecifiers.mjs`'s docstring says the build walks the scanner to decide what to bundle; the build no longer imports it. | Opus P3-1, DeepSeek P3 | **True.** | **Fixed.** It now says the shipped-entry guards use it. |
| 2 | The guard test's docstring describes the old rule ("bundles any entry whose graph reaches a package"). | Opus P3-2 | **True.** | **Fixed.** |
| 3 | The guard test file builds the plugins twice. | Opus P3-3, DeepSeek P2 | **True.** | **Fixed.** One build runs in `beforeAll`. |
| 4 | The relays plugin's vendored copy of `marked` no longer needs to exist: its reason was that plugins cannot resolve bare specifiers, and every entry is now bundled. | Opus P3-4 | **True.** | **Fixed.** `markdownDocument.ts` imports `marked` from the root dependency (the same version, `^18.0.6`). `relays/vendor/` is deleted (the JS, the hand-written `.d.ts` and the README), along with its manual re-copy step on every upgrade. The relays tests and the plugin matrix's Relays leg run against the bundle. |
| 5 | The transpiled per-file output still ships beside each bundle and is never requested. | Opus P3-5, DeepSeek P2 | **True.** | **Not fixed, by choice.** There is no runtime effect. A blanket delete is wrong: `git/browser/git-contract.js` is reached from `git/server-plugin.js` (DeepSeek's evidence). A safe prune needs a reachability walk from every server module. Recorded as a maintenance item, to be done if package size starts to matter. |
| 6 | `browserEntryManifests` has a ternary whose branches are equal, and an unused `browserRoot` local. | Opus note, DeepSeek P3 | **True.** Older than this diff. | **Fixed.** `resolve(dir, modulePath)`. |
| 7 | The guard enumerates only top-level plugin directories, while the build recurses. | DeepSeek P3 | **True.** | **Fixed.** The guard walks the built tree at any depth, as the build does. |
| 8 | The probe's failure matcher misses the activation-failure log ("Failed to register PI WEB plugin"). | DeepSeek P3 | **True.** | **Fixed.** |
| 9 | The probe records only when a request is issued, so a reload served from the HTTP cache would pass without crossing the emulated link. | DeepSeek P3 | **Not true here.** The plugin modules are served with no `Cache-Control`, no `ETag` and no `Last-Modified` (checked with `curl -I`), so the browser has no freshness to reuse, and every reload fetches them over the wire. The first-row time includes them. | No change. |
| 10 | The probe allows 1.5 s while §4.3 cites 1.0 s. | DeepSeek P3 | **True as worded.** The 1.0 s target belongs to the place-before-plugins slice, which waits on the owner. | **Fixed.** The leg's docstring says 1.5 s is the ceiling until that slice, and that the leg tightens with it. |
| 11 | The probe reads only `PI_WEB_PROBE_BASE`, while sibling probes also accept `PROBE_BASE`. | DeepSeek P3 | **True.** | **Fixed.** |
| 12 | `docs/plugins.md` describes asset URLs as relative to the final built module. In a bundled plugin, `import.meta.url` is the entry's URL in every module, so an asset referenced from a non-entry module would 404. | DeepSeek P3 | **True.** Correct today: the only user is an entry. | **Fixed.** The doc says to place assets relative to the entry of a bundled plugin. |

Hunt items, as both lanes answered them: behaviour preserved (false that it changed), external plugins untouched, watch mode fine, server modules untouched, no duplication, cache fine. The guard misses a computed top-level `import(x)` or `new URL` + `fetch`; no plugin does that today.
