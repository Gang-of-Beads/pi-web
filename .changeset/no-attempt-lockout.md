---
"@gang-of-beads/pi-web": patch
---

A wrong access token no longer locks anyone out. PI WEB used to refuse every token from an address for up to ten minutes after 20 wrong ones, so a page that still held a machine's old token used up the allowance in one load and the right token was then refused; 200 wrong tokens from anywhere stopped new sign-ins for everyone. Tokens have at least 32 characters and cannot be guessed over the network, so wrong ones are now simply refused.
