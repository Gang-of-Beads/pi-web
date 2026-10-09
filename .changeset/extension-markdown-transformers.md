---
"@gang-of-beads/pi-web": patch
---

Pi extensions' markdown transformers (`registerMarkdownTransformer`) now apply in the conversation, as in pi's terminal: a finished user message, assistant reply and its thinking are drawn as the extensions change them, live and after a reload. Copying or quoting a message still takes what was said, and a reply in progress shows its own text until it ends. Restart the session daemon and reload the page.
