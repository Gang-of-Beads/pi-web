---
"@gang-of-beads/pi-web": patch
---

An idle page on a git workspace stops asking itself the same question.

`git status` refreshes .git/index. The workspace watcher sees that write, the
client refetches the file tree and the status, that status refreshes the index
again: a loop at the watcher's 250ms debounce. Measured on the owners own
session: 13 tree and 13 status requests per 4 idle seconds, 18 app renders a
second, which is what the page was shaking from. `git --no-optional-locks`
leaves the index alone, which is the canonical fix.
