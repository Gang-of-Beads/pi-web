---
"@gang-of-beads/pi-web": patch
---

A message you send is drawn as what it will become (said, or Queued while the agent is replying) for up to 10 seconds while the machine has not answered, up from 1.5. After that it reads "Not confirmed yet" instead of "Sending…": it is still being tried, and only a machine that says no makes it "Not sent". On a slow or reconnecting link, sends no longer flash a mark and change it back.
