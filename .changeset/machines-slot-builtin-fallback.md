"pi-web": patch
---

The context navigation's machines section becomes a slot: the machines plugin contributes the section body, rendered from a host-fed snapshot (roster, selection, per-machine activity flags) and acting only through host callbacks. With no contribution the machine step hides from the context switcher and the navigation panel instead of rendering a core list - the proxy and fleet routes keep degrading to the local machine, and the context bar still names the selected machine.
