---
"@vincenthanxiaodu/pi-web": patch
---

Stop question and dialog cards from scrolling inside the transcript. Long asks and confirmations bounded their own body, so a card sitting in a scroller got a second scroller inside it: reading a plan crossed a scroll boundary mid-sentence and the content appeared to jump in and out of its own box. The cards now grow with their content and pin the answer controls to the bottom of the viewport instead, which is what kept the buttons reachable in the first place.
