---
"@gang-of-beads/pi-web": patch
---

Opening the app sends fewer requests. The unread markers and the pinned sessions are read once, when the live connection opens, instead of twice. If that connection does not open within about a second and a half, they are read anyway. A project's workspace deletions are read once when the project is opened. A slow answer for one project no longer shows up after you have moved to another, and a project you open while that answer is still pending is read right away. Reload the page to pick this up.
