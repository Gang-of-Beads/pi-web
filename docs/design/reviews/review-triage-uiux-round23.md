# Round 23 triage: the fourth copy, the spent record, and the sheet that arrives last

Configuration: the same three bllm lanes against the round-22 HEAD. Lane B
and lane C independently found the same defect (the runtime refresh's missing
selection guard), which is the strongest convergence signal yet — and the
defect is in round-22's own fix wave, whose changeset claimed a guarantee
only half-delivered. The "claims outrun edits" class recorded in round 21
has now happened to this process's own round-22 record.

## Fixed in this wave

1. **The runtime refresh gets the selection guard its twin has** (lanes B/C,
   Medium): a late runtime failure for machine A painted machine B's screen.
   The guard is opt-out, because the settings path refreshes an unselected
   machine on the reader's explicit ask and its failure is the answer.
2. **Deleting a machine retires the claim about it** (lane C, Medium): the
   retirement model presumes the scope's future replies can disprove the
   claim; a deleted machine has none, so the claim survived forever. The
   claim is cleared with the machine.
3. **The spent record is not a retraction** (lane B, Medium): the daemon's
   interrupted-runs record is read-and-clear, so after the boot read spent
   it, every later read answered empty — and the client adopted that empty as
   "the runs have since continued", erasing markers the reader was on their
   way to act on. Only the boot read adopts an empty record now; whether a
   run has continued is arbitrated by live session state, which the
   rendering already does.
4. **The reader's dismissal cancels the expiry timer** (lane B, Low): a
   same-batch identical re-raise was a new claim that the previous schedule
   then erased.
5. **The last width:100%-with-padding siblings** (lane A): the action
   palette, the autocomplete menu and the git commit row draw border-box now,
   same family as round-22's three.
6. **One state, one colour in the rail table** (lanes A/B/C): the success
   rule's .session-state.running membership was overpainted by the accent
   rule below at equal specificity — two colours written for one state, one
   of them dead by order. The membership leaves the success rule and the
   comment says why.
7. **The unread halo is one motif** (lanes A/C): the machine vocabulary's
   ring mixed accent at 20% while the session vocabulary mixed purple at 22%;
   both are purple 22% now.
8. **The focus ring stops overriding the list's own radius** (lane A): the
   (0,2,0) focus-visible rule re-asserted a radius the list had changed to a
   pill.
9. **The fetch legs answer, so they report** (lanes B/C): the session-tree
   fork, terminal-command-run, plugin-manifest and plugin-backend fetches now
   report reachability like request() does; the same two sites throw
   HttpError carrying the machine scope instead of plain Errors that land
   page-scoped.
10. **The model's pivot has tests** (lane B): machineIdFromUrl — every
    machine-scoped claim depends on it — has direct tests, and its
    decodeURIComponent no longer sits outside the try that must not throw.
11. **Dead references to the deleted machine switcher** (lanes A/C): the two
    comments that explained the present through the removed component now
    describe history as history; the rail contract's stale line-number
    reference and its unmentioned co-owned override table are corrected.

## Owner decisions pending (asked at the end of round 22)

- Scope switches clearing reader-retired failures.
- "Check again" performing a full selectMachine.
- The composed terminal banner's wording (name vs. anonymous short form).

## Owner decisions this round adds

- **Host stylesheet order** (lane A, P2): host sheets append after plugin
  static styles, so same-specificity bare button rules silently lose — the
  terminal soft keys render 32px instead of their declared 36px comfort
  floor, in the UI font instead of mono. Two directions: host-as-base-layer
  (prepend) or plugins must class-scoped-raise. An architecture decision.
- **Deep-link boot race** (lane B, Medium-low): the boot interrupted-runs
  read can be consumed and discarded for the local machine when a deep link
  selects a remote machine concurrently. Needs a selection-generation design
  (lane sketched one); deferred with reason.

## Deferred with written reason

- **The restore ladder reads the shared banner as its own signal** (lane B,
  Low): an unrelated banner during the ladder window makes it misjudge;
  needs a ladder-private success signal. Low frequency.
- **Badge motif tokens** (lane C, Low): the dock's currentColor rewrite and
  the selected-row/rail accent collision are visual decisions.
- **Rail contract tests** (lane C, Low): a 22-rule visual contract with zero
  tests — a test-investment decision, with the shape sketched.
- **The "sending" kind and the core activityBadge exports** (lane C, Low):
  the core module's two exports have no production consumer (test-only, the
  known knip blind spot); removal risks diverging from the plugin copies.

## Erratum (round-22 record)

- Round-22 item 5 said the selection check was "now the third copy's missing
  half"; the diff delivered it only for refreshMachineHealth. The runtime
  copy was a fourth, unnamed — fixed this round.
- Round-22's FALSE verdict on the rail success rule ("both halves are live")
  was right about matching and wrong about effect: the later accent rule
  overpaints every row the success membership matched.
- The expiry model's "not by matching the wording" wording (round-17
  decision 5, the round-20/21 changesets) is superseded by round-22's gate:
  expiry consults both the retirement mark AND the wording layer's verdict.
  The historical records stand unedited; this page is the erratum.
