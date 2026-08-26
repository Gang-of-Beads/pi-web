---
"@vincenthanxiaodu/pi-web": patch
---

Give the session name the room to be read, and lay sessions out as tiles

Three things a phone made worse. The context row gave every chip the same 42vw,
so the session name - the one chip that answers "which of these am I looking
at" - was truncated to "pi-...", while the machine and project names beside it
were recognisable from a few characters anyway. The session chip now takes the
width it needs; the row already scrolls, so this costs the others nothing.

The session switcher listed one session per row, a column of wide, mostly empty
cards, so choosing between a dozen sessions meant scrolling a list that wasted
half its width on every row. Sessions are now tiles that take as many columns
as fit, which is two on a phone and one when there is only room for one.

Opening the switcher no longer leaves the on-screen keyboard covering the list
it exists to show. Only text entry is blurred: taking focus off a button would
cost someone on a physical keyboard their place for no benefit.
