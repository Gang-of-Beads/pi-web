---
"@gang-of-beads/pi-web": patch
---

Context chips are one size per pointer, not one size per container.

The chips' value text stepped down by container width: the projects nav
renders them ~103px wide, the sessions drawer ~150px, so the same control
changed size when the reader moved between the two surfaces - the growing
and shrinking the owner reported. Coarse pointers now get the compact size
everywhere (the fallback words still fit the narrowest step), and fine
pointers keep the container step for genuinely narrow windows.
