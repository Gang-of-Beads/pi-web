---
"pi-web": patch
---

The phone's session panel names its scope and its tools look designed

The workspace tool list at the bottom of the phone panel rendered as bare
text rows, and the header row floated gear and Actions over dead space with
nothing naming which project or workspace the reader was in - so picking a
workspace from the cross-project switcher could look like every session
vanished. The panel header now names the scope (project · workspace) and
opens the matching picker when tapped, tools render as icon cards with a
clear selected state, section headings drop their uppercase styling, and a
workspace change that leaves the phone without a session returns to the
picker instead of an empty chat invite. Route writes no longer attach a
tool parameter when no workspace is selected.
