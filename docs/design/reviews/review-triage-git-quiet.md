# Review triage: P5 slice c, the git panel reads its status only while someone looks

Review run `94c0818e` used two lanes on `reviewer`: Opus 5.5 and DeepSeek 4.1 flash max. Both returned **OK with notes**. Neither found a P0 or P1, and both answered "false" to every hunt item about missed reads. Each finding was checked against the source before triage.

| # | Finding | Lane | Verdict | Action |
|---|---|---|---|---|
| 1 | The test drove `reportShown` by hand, so the observer wiring had no CI gate. happy-dom's `IntersectionObserver` does nothing. Observing the activity element itself (which has no box), or failing to forget the panel on disconnect, would still pass. | O-2, D-2 | **True.** | **Fixed.** A new test stubs `IntersectionObserver` and checks four things: the panel's own `section.git-panel` is observed; leaving the screen stops the poll; coming back reads once; after disconnect the observer is disconnected and a late callback reads nothing. Mutants MB (observe self), MF (keep observing) and MG (no connected guard) are killed. |
| 2 | `watchedPanels` was last-writer-wins, and its delete was unconditional. If a later template reused the section and re-created the child, the older element's disconnect would remove the newer element's mapping, and the poll would stay stopped. | D-5 | **True, but not reachable with today's template.** | **Fixed by design.** Each activity element now owns its own observer of its own parent and disconnects it, so the shared map is gone. |
| 3 | `refresh()` returned the read already on its way. A change announced during that read was answered by the earlier response, and the change waited up to 8 s for the next tick. | D-4 | **True. It predates this slice**, and breaks the D5 rule "a read on an edge never trusts a read already on its way". This slice makes `workspace.changed` the only freshness for a hidden panel, so it matters more now. | **Fixed.** `invalidate` marks `statusReadAgain` when a read is on its way, and one more read follows when it ends. A burst of changes during one read costs one more read. Test: "reads once more after a read that was on its way…". Mutants MA and MH are killed. |
| 4 | A sheet or dialog drawn over the panel keeps it intersecting, so the poll runs under an overlay. | O-1, D-6 | **True, by design.** IntersectionObserver v1 does not see occlusion. | **Wording fixed.** D5 now says that "on screen" means laid out in the viewport, and that an overlay does not stop the poll (one read too many, never one too few). |
| 5 | The probe did not test the `workspace.changed` path that the docs rely on, nor the tab coming back. | D-3 | **True.** | **Fixed.** New legs:<br>- a file written in the workspace while the panel is hidden refreshes it, after 2.6 s (the tree window is 2.5 s), with a precondition that a runtime in the workspace is open, so the daemon watches it;<br>- dispatching `visibilitychange` back to visible reads within 3 s (104 ms measured). |
| 6 | The object-model line reference `git-panel.ts:1223` was stale. | D-1 | **True.** | **Fixed.** It now points at `GIT_POLL_INTERVAL_MS`, not a line number. |
| 7 | "once at once" read as a typo. | O-3 | **True.** | **Fixed.** |
| 8 | Should this share a helper with `subagents/onScreenMarker.ts`? | both, hunt 5 | **No.** That marker observes itself; this element has no box and must observe its parent. The two live in different plugin bundles. | Not shared. Extract when a third panel needs it. |

## Hunt items (both lanes agree)

1. **Missed reads: false.** `shown` starts true, and every `observe()` delivers an initial entry. The panel and its activity element are replaced together. The host hides panels only with `display: none`, which leaves no box. A setter that restarts while the panel is off screen still connects and reads once.
2. **Hidden tab: false.** The host's resume path invalidates the current tool panel on `visibilitychange`, even when that panel is hidden behind the chat. So the first read happens at once, not up to 8 s later. The probe now measures this.
3. **Observer lifecycle: no leak.** After row 2, each element owns and disconnects its own observer.
4. **Double reads:** a poll and an invalidation that arrive together share one request. A change during a read now trails one more read (row 3).
5. **Owner rules:** no inline comments and no type assertions. The design was recorded first (plan, D5 and §1.16). Nothing is over-built.

Mutation: MA–MH, all 8 killed.
