---
"@vincenthanxiaodu/pi-web": patch
---

Plugins in a manifest are fetched together instead of one round trip after another: five plugins used to cost five sequential fetches on the boot path; now they cost the slowest one. The manifest's order is preserved in the registrations.
