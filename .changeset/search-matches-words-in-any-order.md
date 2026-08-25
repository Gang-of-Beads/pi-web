---
"@vincenthanxiaodu/pi-web": patch
---

Find a model by naming the model and its provider. Searching "opus-5 merchant" returned "No matching options" even though `anthropic-merchant/claude-opus-5` was right there under "opus-5", because the search asked for the words as one unbroken run of characters and "claude-opus-5 anthropic-merchant" never contains "opus-5 merchant". The same model is served by several providers, so naming both is exactly how you tell them apart. Each word is now looked for on its own, so word order and whatever sits between them stop mattering. The action palette and the auth provider list shared the same matcher and the same blind spot: "sessions clean" now finds "Clean Up Sessions". A one-word search behaves as before, and each further word can only narrow the list.
