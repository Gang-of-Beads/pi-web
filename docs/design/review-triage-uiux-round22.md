# Round 22 triage: the scope the producer chose, and the words the expiry ignored

Configuration: the same three bllm lanes against the round-21 HEAD. Lane A
proved its headline finding by running the real modules; lane C read the
notice pipeline end to end. The finding classes: the machine-scope seam was
one branch order away from working, and the 6s expiry kept contradicting
what messages render as.

## Fixed in this wave

1. **The gateway's machine scope survives classification** (lanes A/C, P1 —
   proven by running the real modules): the text-first branch classified the
   message before the HttpError branch ever read the machineId the producer
   had put in its hand, so every gateway 502 landed page-scoped and any
   other machine's success erased it. The HttpError branch goes first now and
   classifies by the message's own evidence; two regression tests pin both
   halves.
2. **A machine-less transport claim falls back to the URL** (lane B): the
   local proxy's 502 carries no machineId in its body, so a sessiond restart
   produced a page-scoped claim that a remote machine's poll erased. The
   error now names the machine the URL speaks about when the body does not.
3. **Expiry follows the wording layer's own verdict** (lanes B/C): a reply-
   retired message the wording table declines to shorten (a composed
   "X is unavailable; reconnecting… <detail>", the retry ladder's terminal
   sentence) rendered with the permanent style but was still deleted after
   6 seconds — and during the ladder the identical re-raises blinked against
   a stale timer. Those messages now stay until their machine's answers or
   the reader retire them, which is what their rendering already said.
4. **The hold window no longer swallows the re-arm** (lane A): clearing a
   banner reset the scope and text but left the previous schedule's marker,
   so an identical failure returning inside the hold window showed forever
   with no timer. The marker resets with the clear.
5. **The health guard checks the machine the reader is on** (lane C — lane B
   had marked the suspicion FALSE on the sequence guard's existence alone;
   the source adjudication found the sequence only moves when the same
   machine is re-polled, so a machine switch was invisible to it). The
   selection check the project and session controllers already use is now
   the third copy's missing half.
6. **The interrupted-runs unknown message is one constant** (lanes B/C):
   raise and retract shared a 96-character literal by copy-paste; a future
   rewording would have left a permanent, unrevokable reader banner. Both
   sites name it now.
7. **TCP deployments heal** (lane B): the daemon wording rule required the
   socket path in the error text, which a TCP-endpoint deployment never
   produces; the daemon's own phrase carries the identification instead.
8. **Width-plus-padding overflow** (lane A): the auth provider list, the
   model catalog and the git file list all declared width:100% with
   horizontal padding and content-box sizing, drawing a permanent horizontal
   scrollbar under classic scrollbars. All three are border-box now.
9. **The spacing guard sees logical properties** (lane A): padding/margin
   -inline-start/-end/-block-start/-end join the scanned set, and the tree
   row's 7px base - invisible to the old regex - is on the scale.
10. **SessionList joins the hide-exit-clears-filter rule** (lane A): three
    plugin lists clear their filter when hidden; the core list kept its
    filter across a hide, silently filtering rows on return.
11. **Dead code** (lanes A/C): the navigation panel's unread machineStatuses
    property (every machineStatuses write re-rendered the panel for a value
    no template reads), 26 orphaned CSS rules across five sheets, the
    subtree-chevron pair, the closed-summary block, the machines-heading
    rule, and a tiles min-height that its sibling overrode.
12. **Docs** (lanes A/B): the two inline-code spans the fix scripts ate are
    restored, operation-model's "remaining piece" reflects the round-21
    retirement, and a stale docstring points at the right banner.

## Adjudicated FALSE (recorded so nobody re-reports)

- **The rail's success-rule half-selector** (lane A claimed
  .session-state.running dead): both halves are live - plugin rows speak
  .activity-indicator.session, session rows speak .session-state.running.
  Only the overridden tiles min-height was real.
- Eight lane-B suspicions (transcript cache scope, subagent rows, prefetch
  keys, quick-switcher flags, hold revival, unknown-flag stall, unix
  ECONNREFUSED, health seq) are checked and solid; lane-b's own list stands.

## Product decisions brought to the owner

- **Scope switches clear reader-retired failures** (lane B): silent-clear
  vs. persist-per-machine is a product semantic.
- **"Check again" performs a full selectMachine** (lane B): navigate-to-check
  vs. background re-poll.
- **Composed terminal banners render as permanent alerts** (lane B): the
  rewrite erases the machine's name; a composed-with-name rewrite needs a
  wording decision.
