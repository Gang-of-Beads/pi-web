---
"@gang-of-beads/pi-web": patch
---

Big transcripts are cached again. The history cache wrote to sessionStorage and
swallowed the quota failure with no eviction, so any page too large for what was
left of the origin's shared budget was never cached at all — and those are
exactly the sessions where reopening is slow enough to feel. A page that does
not fit keeps its tail, which is the part a reader lands on, and a full store
gives up its oldest other session rather than giving up on caching. The cache
takes its storage as a parameter now, so this behaviour is tested against a
store with a real capacity instead of against whatever a test environment's
Storage stub happens to implement.
