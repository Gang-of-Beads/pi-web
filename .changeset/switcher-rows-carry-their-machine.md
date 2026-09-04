---
"@gang-of-beads/pi-web": patch
---

The quick switcher can no longer show one machine's sessions dressed as another's. After switching machines from the header, the reopened switcher rendered the previous machine's cached rows under the new tab with the new machine's badges, and a tap acted on the wrong machine; the loader now clears rows whose machine is not the one being loaded, and actions key on the machine the displayed rows actually came from. The failed-plugin sentences stop blaming a specific plugin for a shared diagnostic and point at Notifications, which exists.
