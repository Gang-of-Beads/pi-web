# Round 24 triage: the schedule is a claim, the boot read is once, and the report vouches for the wrong process

Configuration: the same three bllm lanes against the round-23 HEAD. The
centre of gravity moved deeper into the retirement model: this round's
headline defects are not new producers but identity bugs inside the
model's own machinery — a schedule keyed by wording, a boot read that
re-arms itself, a reachability report that vouches for a process that
never answered.

## Fixed in this wave

1. **The expiry schedule carries the claim, not the wording** (lane C,
   Medium): two machines down in a row can produce identical text; the
   re-arm gate and the timer's "only clear what we scheduled for" compared
   text only, so machine A's timer deleted machine B's banner that never
   answered once. The schedule now carries the machine it was armed for.
2. **The boot read is once per page** (lane B, Medium — the direct residue
   of round-23's own fix): a machine switch tears the socket down and
   reconnects, and that re-entry re-read with boot semantics, adopting the
   spent record's emptiness as a retraction. A page-level flag gives boot
   semantics to the first read only.
3. **The expiry timer resets the schedule marker** (lane B, Low): the twin
   half of round-23's dismissal fix — a same-batch re-raise after expiry
   inherited a spent gate and got no lifetime.
4. **The unreachable deadline branch** (lanes B/C, Low): noticeFromError's
   terminal RequestTimeoutError return is dead (its fixed text matches the
   transport branch above); the comment narrating the transfer moved to the
   branch that actually runs.
5. **The fourth width:100%-with-padding overflow** (lane A, P2): the
   settings nav button — width and padding live in different rules of the
   same sheet, which is why every same-rule scan missed it.
6. **Two touch floors** (lane A): the terminal copy toolbar's buttons take
   the 44px touch floor its own file already gives its siblings, and the
   session subtree toggle stops being 36px wide against 44px-tall
   neighbours.
7. **Geometry comment drift** (lane A): the rail comment's row-class
   enumeration no longer lists the unread rule round-18 removed; the badge
   sheet's "one style block for every surface" claim and its 9px-track note
   now match the code.
8. **ReportedError is gone** (lane C): dead outside its own test since the
   retirement seam absorbed its job.
9. **The unknown banner's promise is fulfilable** (lane B): "Retrying the
   connection will resolve it" promised a resolution the spent record could
   not deliver; it now says what a reconnect actually does.

## Owner decisions this round adds

- **The local namespace is mixed and the URL rule cannot say so** (lane C,
  Medium-High): /api/machines/local/* mounts web-owned routes (projects,
  config, plugins, health) whose 200s vouch for the local daemon's link —
  a daemon-down banner is withdrawn by a response that never touched the
  daemon. Worse, the health route answers 200 with ok:false, so the
  response reporting the machine unreachable is itself counted as proof it
  is reachable. Any fix is a vocabulary decision (distinguish local routes
  that proxy from those that don't, or stop stamping "local" from URLs and
  scope local claims differently). Deferred with both scenarios written
  out; it supersedes round-22's "residual gap" note.
- **Host stylesheet order** (lane A, P2, with regression proof this round):
  the machine list's lg radius has been dead since the plugin migration,
  and the same inversion is what currently keeps the layout alive (the
  adopted :host flex beats the plugin's own dead :host block). Prepending
  the host sheets changes both at once — an architecture decision.
- **Selected rails painting urgency rows** (lane C): deliberate (0,2,0)
  CSS, but it contradicts the "never one thing up close, another at
  scanning distance" invariant for asking/error rows. A design decision.

## Deferred with written reason

- **QuickSwitcher's interrupted predicate split** (lane C, Medium): the
  marker yields only to "working" and consults a third predicate the
  grouping does not; fixing it means choosing the one predicate for both,
  which is the owner's row-fold design territory (already pending).
- **Realtime channel as an answer** (lane B, Low): machine activity
  sockets neither report reachability nor clear claims; a model-design
  decision.
- **pointerQueryOrder's structural blind spots** (lane A): cross-file
  adopted-sheet ordering is invisible to a same-file text guard; the
  fix is the host-order decision above.

## FALSE (recorded)

- openLazySurface's reader-retired comment is correct as written (lane C
  near-miss).
- connectRealtime's default adoptEmpty was NOT correct — lane B's finding,
  fixed above; recorded here because lane B initially doubted the
  round-23 comment's own invariant applied there.
