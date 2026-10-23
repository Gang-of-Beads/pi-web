---
"@gang-of-beads/pi-web": patch
---

Browser plugin pages can now tell whether they are on screen: `host.shown()` answers it, and the `page-shown` and `page-hidden` events tell the page's own plugin when it changes (another page selected, the phone showing the chat, a dialog or the Navigate page over it, another workspace, a hidden browser tab). Files, Git and Terminal poll only while their page is shown. Every workspace page now gets `context.session` (`id`, `cwd` and the session file `path`) while a session of its workspace is open; `context.session.runCommand` is now optional and present only for a plugin that declares `sessionCommands`, so a plugin that calls it writes `context.session?.runCommand?.(...)`.
