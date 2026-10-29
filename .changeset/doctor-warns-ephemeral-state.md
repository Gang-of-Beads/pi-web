---
"@gang-of-beads/pi-web": patch
---

Without a service manager, `pi-web doctor` now warns when the data directory, the config file or the pi agent directory is on the container's own filesystem or in memory: such a directory is writable, so it passed the check before, but its contents are lost when the container is recreated. Mount a persistent volume there, or point `PI_WEB_DATA_DIR`, `PI_WEB_CONFIG` or `PI_CODING_AGENT_DIR` at one. When the mount table cannot be read, doctor says it could not tell.
