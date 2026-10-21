---
"@gang-of-beads/pi-web": patch
---

Offer to install PI WEB as an app on phones and tablets. A dialog, like the update offer, opens once per page load when no other dialog is open: on Android it opens the browser's install prompt, on iPhone and iPad it shows the Home Screen steps and points at the Share button, and on a plain-HTTP address it explains that installing needs HTTPS (iPhone and iPad still get the Home Screen steps, with a note that HTTPS works better). "Later", or closing the dialog, hides it for 7 days; "Don't show again" hides it for good.
