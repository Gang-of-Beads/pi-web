# Goal Round D triage: the delivery-pipeline round

Configuration: three glm lanes verified the Round C fix wave (dc41e086) at
reader level, with sha256-grade delivery checks (dev-server bytes vs dist
artifacts vs source).

## Verification verdict

**4 of 7 Round C fixes reached the reader** (empty-session box-sizing +
centering across four widths, six solid msg-header dividers + AskUserCard,
compact pressed states, session-row pressed state, contributed inset,
context-bar breathing). **3 did not** - and the lanes proved the root cause
is the DELIVERY PIPELINE, not the fixes: `dist/pi-web-plugins/` was built
at 09:32, five minutes before the dc41e086 commit (09:37), so two plugin
fixes (tasks viewer stretch, goals refresh) shipped to readers from a
pre-fix bundle. A third and fourth producer (drawer-control, palette) had
the nested-media dead-CSS class in the client bundle.

## Fixed in this wave

- **Plugin bundle rebuilt and deployed** (D-TRUE-1/D2): tasks viewer
  `align-content: stretch` now served (curl-verified on the dev server);
  goals refresh hoisted rule now in dist.
- **Shared list rows** (T-D3): the project/workspace/machine rows in the
  nav panel and context sheet take the coarse pressed state via shared
  listStyles - SessionList's own shadow had it, the shared rows did not.
- **Rail header breathing** (D3): the desktop rail header takes the same
  2px vertical inset as the context bar - the two 45px header rows across
  the divider are symmetric again.
- **Seventh divider producer** (D4): `.msg.user.queued > .msg-header`
  joins the solid border-muted rule.

## The pipeline lesson (recorded)

`npm run build` was run before the final commits twice; the plugin bundle
step silently served stale artifacts while the client (Vite source) served
current ones - so client fixes verified live while plugin fixes did not.
The verification round is what caught it; the delivery check (dev-server
bytes vs source) is now a lane standard.

Research: docs/design/research/roundd-lane-a.md (end-to-end with sha256
delivery checks), roundd-lane-b.md (desktop + responsive),
roundd-lane-c.md (token layer).
