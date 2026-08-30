# 3.3 — transcript cursor replay e2e (the convergence leg)

Run: 2026-08-31, 00:27–00:31 local, 8505 stack, session 01a0545a (test project,
`/private/tmp/test`), model botim-bllm/glm-5.3-flash. The browser (393×850) held the
session open and listened on its socket throughout; the turn was submitted over the API
so the browser was a pure stream observer.

## Sequence

1. Turn 1 (a 500-word story) completed cleanly — 2 messages on disk (the baseline).
2. Turn 2 ("Write another 300-word chapter") submitted; the browser watched the stream.
3. Mid-stream (4 s in, 00:30:54): armed `POST /api/debug/frame-drop {count:3}` — three
   socket frames dropped daemon-side.
4. The turn completed; the client's gap machinery ran (no reload, no manual refresh).

## Measured

| Measure | Value |
| --- | --- |
| Frames dropped | 3 (mid-stream) |
| Wire detection | browser console: `session scope lost frames: expected 176, got 179 (3 missing)` |
| Daemon messages before / after | 2 / 4 |
| Browser rows after | 4 messages (`article.msg[data-index]` 0–3) + 2 event groups — **no duplicated bubbles**, roles alternate cleanly |
| Transcript equality | **DIFF = EMPTY**: all 4 messages byte-identical to the daemon's transcript file (77 / 2730 / 52 / 1654 chars), read through the app's own per-message copy machinery (the DOM text is a virtualization window — the copy path is the exact full text) |
| Page reloads during the leg | 0 (the page was loaded once, before turn 2) |
| Convergence | equal at the first post-completion read; the drop-repair latency itself was not separately instrumented in this pass (the detection log and the equal transcript bound it to within the turn's tail) |

## Artifacts

- `n33-final.png` — the transcript after convergence (the chapter's ending rendered).
- The daemon text dump and the browser copy extraction are preserved in the session
  notes; the diff ran in-session and printed `DIFF = EMPTY` (4/4 IDENTICAL).

## Statement

The mid-stream 3-frame loss was detected on the wire, repaired by the client's gap
machinery without any reload, and the resulting transcript is byte-identical to the
daemon's transcript file with no duplicated bubbles. Evidence from one seeded run —
not a general proof.
