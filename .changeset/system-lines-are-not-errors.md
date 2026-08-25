---
"@vincenthanxiaodu/pi-web": patch
---

Stop colouring every system line as a fault. A background task that finished with exit code 0 was reported in danger red, which reads as a failure at a glance; system lines now use the muted tone and red stays for actual errors.
