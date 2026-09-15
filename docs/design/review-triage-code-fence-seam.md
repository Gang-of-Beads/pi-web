# Review triage: code-fence renderer seam (goal task 2)

Commit under review: 39ea0b5a (+ fixes below). Two glm max-thinking lanes,
split safety/lifecycle vs contract/product; standard = AGENTS.md rules +
docs/design/plugin-architecture.md.

| # | Lane finding | Adjudication | Action |
| --- | --- | --- | --- |
| P1 (safety) | Claimants invoked on partial (unclosed) fences during streaming, once per settle parse, no dedupe - repeated paid work and side effects for a diagram renderer | TRUE | Fixed: `formatted-text` gains `streaming`; ChatView passes `status.isStreaming`; no claim while streaming or while a suffix is pending, claims reconcile when the stream ends |
| P1 (contract) | Claim set frozen after first enhancement: a plugin registering after a message drew never claims it; a disposed plugin's drawing stays on screen | TRUE | Fixed: `updated()` reconciles every wrapped block when the lookup identity changes - drawings with no claimant come down, newly claimable blocks go up |
| P2 | Pending render mounts after its plugin is disposed | TRUE (latent) | Fixed: the claim is re-checked after the await |
| P2 | Renderer resolving a non-Node prints "undefined" as content | TRUE | Fixed: non-Node is a failure (logged), block stays plain |
| P2 | Renderer failures swallowed with no log | TRUE | Fixed: `console.warn` like the other host↔plugin boundaries |
| P2 | Copy button could copy `<pre><code>` inside the drawing | TRUE | Fixed: copy reads `:scope > pre > code` |
| P2 | Folded source (24px, .55 opacity, no expand affordance) introduced an E4/J2 inconsistency vs unclaimed blocks | TRUE | Fixed: fold removed; drawing sits above the full source block |
| P2 | Seam ledger not updated | TRUE | Fixed: rows 8 and 9 in plugin-architecture-status.md |
| P2 | Closing brace glued to the next member | TRUE | Fixed |
| — | Trust boundary / sanitizer | FALSE | drawing is appended as DOM after the safe parse; fence bodies stay escaped (test) |
| — | Late-drawing guard vs identical-HTML rebuilds | FALSE | `!wrapper.isConnected` covers the rebuilt-DOM case |
| — | One claimant per language per machine vs remote mirrors | FALSE | same machinery and precedence as `messageRenderers` |
| — | Public/internal/baseline type drift | FALSE | byte-identical; baseline enforced by buildContents test |
| — | Non-transcript `formatted-text` sites (thinking, skill, tool text) stay plain | product note | intended: fences are claimed only in message text parts; recorded here as the rule |
| — | AbortSignal on `render` | deferred | a settled-only claim removes the repeated-call case; revisit if a consumer needs cancellation |
