---
"@gang-of-beads/pi-web": minor
---

Play audio and video workspace files in the file viewer. MP4, WebM, MOV, MKV, OGV, M4V, MP3, WAV, OGG, OGA, M4A, AAC, and FLAC files now open in a native player instead of a download prompt. Media is streamed rather than buffered and answers byte-range requests, so seeking inside a long clip does not refetch it, and clips up to 512 MB preview. Existing image, HTML, and PDF previews keep their previous limits and containment.
