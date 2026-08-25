---
"@vincenthanxiaodu/pi-web": patch
---

Keep the model's name readable on a phone. The button naming the current model declared an ellipsis it could never draw: as a flex box its text wrapped instead, and the fixed height cut the second line off mid-name. The provider prefix now gives way first, so "anthropic-merchant/claude-opus-5" narrows to "anthr… claude-opus-5" and the model id — the part that names the choice — survives down to the narrowest screen, with the whole name on hover. The drawer's tabs also scroll sideways with their scrollbar hidden: two tabs need more room than a phone gives them, so the second one was simply absent. They now fade at the edge like the workspace tool tabs and the context bar already did, from one shared implementation.
