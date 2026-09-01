---
"@vincenthanxiaodu/pi-web": patch
---

A waiting card's actions stay on screen. The question and dialog cards each carried their own height cap, so a tall one — an ask-user question with many options, a task-confirmation dialog above a queue strip — pushed its confirm buttons below the fold of an inner scroller the thumb could not drive. The height budget now lives once in the waiting slot: the slot owns it, every card fills it as a flex column whose body is the single scroller and whose action row never scrolls away, and a new waiting card inherits the contract instead of needing a cap of its own.
