---
"@gang-of-beads/pi-web": patch
---

The theme pack no longer ships inside PI WEB: it lives in its own repository and installs as the `@gang-of-beads/pi-web-themes` package (npm or git), which also ends the id conflict between a bundled copy and an installed one. The appearance panel's contract is unchanged - any plugin may contribute themes - and a checkout that wants the packs installs the package.
