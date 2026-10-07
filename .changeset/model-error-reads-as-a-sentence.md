---
"@gang-of-beads/pi-web": patch
---

A reply that ends in a model error now reads as one plain sentence: a temporary provider error, a conversation too long for the model, or an error the provider returned, each ending "Send a message to try again." The provider's own text sits behind a Details disclosure under it. Which kind it is comes from pi's own classifiers, so an error whose text mentions "aborted" is no longer shown as interrupted. The old thinking-block hint that pointed at /tree is gone. Reload the page to pick it up.
