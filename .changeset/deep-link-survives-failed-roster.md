"pi-web": patch
---

A machine deep link survives a failed machines roster: on boot the shell no longer rewrites the URL to the local machine when the roster listing fails - it retries the listing on the same ladder the remote-restore loop uses and re-enters the boot restore once it recovers, leaving the machine, project and session in the address bar the whole time. Exhaustion leaves the failed-roster panel speaking and the link intact.
