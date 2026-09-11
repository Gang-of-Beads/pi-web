---
"@gang-of-beads/pi-web": patch
---

A reload or reconnect replays committed history from the watermark instead
of re-fetching the page.

The transcript refresh always re-fetched its full page over the wire, even
when this browser had just read one moments before. The refresh now cites
the stream seq its cached page is current through, and the daemon's replay
window answers with just the frames after it - applied to the cached view,
no history payload. A watermark older than the replay window, a trimmed
tail, or any replay failure falls back to the full fetch, which restamps a
fresh watermark; the fallback path reads status only after the replay
verdict so a resync costs nothing extra.

Together with the span cap this keeps long sessions cheap on flaky links:
the live tail rides the seq ring, and the pages behind it stay cached.
