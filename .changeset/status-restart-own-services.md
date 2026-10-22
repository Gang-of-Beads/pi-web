---
"@gang-of-beads/pi-web": patch
---

Offer restarts only when the services installed for this user run that PI WEB: Restart web and Restart session daemon on the Updates page, and Restart in Settings → Machines, whose rows show only the keys the machine offers and say why for the others, and whose Update every machine and Restart every machine send only the machines that offer them. A second PI WEB on the same account, started by hand or from a terminal, no longer offers a restart, a computed update, or an update command inherited from the installed services that would restart the other installation and stop its sessions; it says to restart it the way it was started. Development installs (`pi-web install --dev`) restart and update with the CLI.
