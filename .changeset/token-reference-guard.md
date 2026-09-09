---
"@gang-of-beads/pi-web": patch
---

A reference to a token nothing defines now fails the suite. Three of them had
shipped — a failed command receipt, the activity dock's waiting and error
states, and a rename dialog field — each silently dropping the property it was
written for while every other guard passed. References that carry a fallback
stay legal, because a fallback is the contract an optional token needs.

Round-four fixes: the quick switcher routes its row mark through the same
arbiter the session list uses, so an unread finished session shows one mark
instead of a blue dot painted over a purple one; its rows and footer state
their own type instead of dropping to the browser's Arial; dialog close
controls are one size on a mouse; the message meta control and the disabled
row's remedy line are readable instead of dimmed to 2.55:1 and 2.14:1; the user
role label reads at full contrast on its own fill; theme cards clamp both
variable lines; and "disabled" is one opacity token rather than .5/.52/.55.
