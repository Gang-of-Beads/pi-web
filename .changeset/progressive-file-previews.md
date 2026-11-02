---
"@gang-of-beads/pi-web": patch
---

The Files page shows photos, videos and audio in stages, so a slow link shows something at once: a photo appears as a blurred outline, then a small image, then whole; a video shows its cover, length and size and starts on ▶; audio shows its length and size. The outline, small image and cover are made with the machine's own ImageMagick or ffmpeg and cached; a machine without them, or a file they cannot read, still opens whole, and a preview that does not arrive is asked for again by itself. Previews from remote machines stream as they arrive, so a slow machine's photo no longer has to arrive whole within 30 seconds, and videos there no longer fail above 10 MB and can be seeked. Downloads are no longer compressed, so the browser shows their size and progress. Plugins get `files.stagedFile` in the browser and `reply.sendStage` on the server, and `files.limits.streamPreviewBytes` is renamed `mediaPreviewBytes`.
