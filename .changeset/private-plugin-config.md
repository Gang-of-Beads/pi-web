---
"@gang-of-beads/pi-web": patch
---

Keep private plugin settings away from the browser. A plugin's `serverSettings` block in the PI WEB config is now left out of every config answer, including the shared-theme save and other machines' config and workspace listings; answers only say which plugins have one. Ordinary settings saves keep stored private settings. Settings has no control for them yet: change them in the config file, or through the config API with an explicit replace or clear operation, which PI WEB forwards only to machines that support it. Update a machine your browser reaches directly before you give it private settings. A config file PI WEB creates is readable by its owner only.
