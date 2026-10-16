---
"@gang-of-beads/pi-web": patch
---

The curl installer now checks what it needs before installing anything: Node.js 22.19.0 or newer, an npm that can install global packages as your user, and on Linux python3, make and a C++ compiler for the terminal's native module. When something is missing it says what to install or change, instead of failing halfway through npm with a long build or permission error. The installation guide lists the same requirements, how to use a distribution's Node.js without `sudo`, and the `dbus-user-session` package minimal Debian and Ubuntu images need for user services.
