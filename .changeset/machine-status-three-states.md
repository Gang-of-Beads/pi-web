---
"@gang-of-beads/pi-web": patch
---

Machine cards show one of three states: Online, Offline or a red Error, with the reason on hover. A Machines list checks every machine once each time it comes into view, and a check finishes even after you leave the list, so the next visit opens on fresh answers. A machine that does not answer within 8 seconds reads Offline at once; the yellow "Trying to sync" and the "Checking…" ring are gone, and nothing checks on a timer. Browser plugins listening to the fleet's machines now start one round of checks instead of keeping them running; `fleet.refreshMachine` checks a machine again.
