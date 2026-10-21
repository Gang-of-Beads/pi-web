---
"@gang-of-beads/pi-web": patch
---

A tool-result image that cannot load no longer makes the transcript jump. The image keeps one box while it loads, retries or fails, and the box says what is happening. Retries wait 2, 4, 8, 16 and 32 seconds and pause while the machine is unreachable. When the machine is back, every image that did not load tries once more by itself. After the last try the box says "Did not load". Tapping a box that says the image did not load tries again at once. Before, the page fetched the image again many times a second while the machine was down.
