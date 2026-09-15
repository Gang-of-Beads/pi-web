# Review triage: tool-result images by reference (goal task 1)

Commit under review: b5cdbf43 (+ fixes below). Two glm max-thinking lanes,
split daemon/wire vs client/UX, standard = AGENTS.md rules (no second
producer, data carries its scope, absence is not negation, no permanent
error states, client URL convention, minimal core).

| # | Lane finding | Adjudication | Action |
| --- | --- | --- | --- |
| P0-F1 | Remote machines: the browser builds `api/machines/<remote>/…/images/<n>` but the machine proxy only federates allowlisted routes; the image route was missing, so remote sessions with big screenshots regressed to a permanent broken image | TRUE | Fixed: image route added to `FEDERATED_HTTP_ROUTES` with the preview body bound; the remote edge already decodes, this side relays type + cache headers (`app.remoteProxy.test.ts`) |
| P1 (client) | No `@error` on the transcript `<img>`: a failed lazy fetch (daemon restart, offline PWA, archived session, compaction race) is a permanent broken glyph and the zoom opens the dead URL | TRUE | Fixed: `@error` → tap-to-retry row; retry re-addresses the block with a nonce the immutable cache cannot answer from (`ChatView.image.test.ts`) |
| P2-F2 | Subagent-run transcript pages projected through plain `branchMessages`, bypassing the text bound and image deferral — a sibling producer (not client-reachable today) | TRUE | Fixed: run transcripts go through `historyMessagesFromEntries`; ref scope for that view is decided when the view ships |
| P2-F4 | Web edge served whatever `mimeType` the tool result carried on the app origin | TRUE (hardening) | Fixed: non-`image/*` (and svg) served as `application/octet-stream`, `x-content-type-options: nosniff` |
| P2-F5 | `tool.update` partials not image-deferred | TRUE (no producer today) | Fixed alongside `tool.end` (same call shape) |
| P2 | Live `tool.end` ref path untested | TRUE | Fixed: `chatTranscript.test.ts` drives a ref-bearing `tool.end` |
| P2 | Probe does not assert the immutable cache header | TRUE | Fixed: probe fails when an image response lacks `immutable` |
| — | `imageScope` unset in production | FALSE | chat-view is the only transcript renderer and binds cwd + machine from one selection |
| — | `resendMessage` drops ref images | FALSE | refs exist only on tool results; user lines never carry them |
| — | `messageContentKey` collision | FALSE | `:ref:` marker keeps components disjoint; only user lines are keyed |
| — | `findToolResultImage` wrong branch / index drift | FALSE | one entry pool per file; text bound preserves positions |
| — | `base64ByteLength` for unpadded input | FALSE | exact for valid lengths |
| — | Immutable cache vs changing bytes | FALSE | tool results are append-only; compaction deletes rows (the race is the P1 above) |
| — | Memory for 5 MB screenshots at the edge | note | ~3× transient per fetch, bounded by lazy + immutable cache; streaming deferred until a producer needs it |

Live verification after fixes: `scripts/probe-tool-result-images.mjs` on the
rebuilt 8505 stack (seed registered as a project) — wire 5.8 KB for six
200 KiB screenshots, 0 inline, all rendered images addressed through the
route, fetched as `image/png` with `immutable`, history cache entry written.
