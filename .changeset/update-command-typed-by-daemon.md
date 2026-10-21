---
"@gang-of-beads/pi-web": patch
---

Run the Updates page's update and restart commands even over a slow connection. The machine now types the command into its new terminal itself, once the shell has drawn its prompt, instead of waiting for the browser to reach the terminal, so a phone on a slow link no longer opens an empty shell that says "did not run: The terminal did not open in time". A machine that refuses the terminal says why; when the machine does not answer, the page says the command may have started and opens the Terminal page to check before running it again. Restart the session daemon to apply; until then the page types the command as before, waits longer for the terminal, and when it still cannot, says so in a dialog that names the machine and shows the command, wrapped between its words and ready to copy, with Open Terminal to take you to that machine's shell.
