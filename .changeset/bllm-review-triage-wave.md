---
"pi-web": patch
---

Follow-up fixes from the three-lane bllm review of every element surface

The review converged on two settings-history bugs, both now fixed: closing
the sheet left its stacked URL frames below, and the back gesture died on
them because the route comparison could not see the settings parameter - a
settings frame is now a meaningful back target in both directions; and the
drill-down's "‹ Settings" control guessed at history depth, so a deep link
or a plugin's section entry exited the sheet - the list frame is now
tracked, settings writes always push their own frame, and the back control
pops only when it owns a frame. The landscape follow-ups land too: the
shell's paired CSS rules and the settings sheet's phone detection follow
the same coarse-or-mobile rule the layout predicate uses, so a landscape
phone no longer gets a hybrid shell or a desktop-sized settings modal.
Also in this wave: the composer's pending attachments clear on a session
or machine switch instead of delivering session A's image into session B;
the prompt editor regains the lost media-query opener around its compact
footer rules; the sessions heading stops claiming "0" while the listing is
in flight; settings controls get accessible names; small touch targets
meet the coarse-pointer floor; tool-card badges ellipsize instead of
crushing the label; and the context-bar panel toggle reports the state the
shell actually renders.
