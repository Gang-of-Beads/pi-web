---
"@gang-of-beads/pi-web": patch
---

A session forked or copied on one device now appears at once in the session board and quick switcher of every other device. Before, it showed up only after the next full reload of the board. A session row that was already listed keeps its title and message count instead of briefly turning blank. A rename the machine refused no longer stays in those lists. The session daemon needs a restart for forks and copies to appear at once.
