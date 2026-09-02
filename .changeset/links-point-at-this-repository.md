---
"@gang-of-beads/pi-web": patch
---

Documentation links point at this repository instead of the upstream site

The README, the docs pages, the example plugin and the Nix package all linked to
`pi-web.dev`, which is the upstream project's live site and carries its install
instructions and its package name. Anyone following the README was sent there.
The rename fixed repository URLs and the package name and missed the domain
entirely; this finishes it - 78 references across 14 files, plus the banner image
now served from this repository.

The two documentation deploy jobs are unchanged and still skipped here, but no
longer describe themselves as publishing to a domain this project does not own.
