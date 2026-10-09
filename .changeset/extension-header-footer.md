---
"@gang-of-beads/pi-web": patch
---

Pi extensions' custom header and footer (`ctx.ui.setHeader`, `ctx.ui.setFooter`) now show in PI WEB: on the extension's page in Go to, with its widgets, the header first and the footer last, following every update. A footer gets the git branch, the extensions' statuses and the provider count as in pi's terminal. Restart the session daemon and reload the page.
