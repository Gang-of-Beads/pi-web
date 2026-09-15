---
"@gang-of-beads/pi-web": patch
---

Tool-result screenshots travel as references, not inline bytes.

A transcript page whose tool results carried screenshots still shipped every
image as inline base64 - a 200 KiB screenshot was 200 KiB of page, six of
them 1.2 MB - and the browser's per-session history cache skipped exactly
those sessions, so screenshot-heavy transcripts were the slowest to reopen.
Image blocks above 8 KiB now travel as a `{toolCallId, index}` reference and
the browser fetches the bytes through a per-image route when the image
scrolls into view; small images stay inline. The session file is untouched.
