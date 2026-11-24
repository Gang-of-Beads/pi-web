---
"@gang-of-beads/pi-web": patch
---

Raise `minimatch` to 11.0.9 and `glob` to 14.0.6 with workspace overrides, clearing the two moderate Dependabot advisories (a glob-pattern denial of service, and an `AbortSignal` cancellation bypass). Both were reached through dev tooling (eslint, typescript-eslint) and `@fastify/static`. The full suite, the static checks and the build are unchanged.
