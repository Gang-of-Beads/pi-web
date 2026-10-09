---
"@gang-of-beads/pi-web": patch
---

Adding a project with "Create the folder if it does not exist" ticked used to say "That folder cannot be read with this account's permissions" when the folder could not be created. It now says "That folder could not be created there. Check the path and this account's permissions." A file standing in the path is reported as "That path is a file, not a folder." Restart the web service to pick this up.
