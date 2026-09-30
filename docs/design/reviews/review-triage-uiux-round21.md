# Round 21 triage: the gateway's own vocabulary joins the model

Configuration: the same three bllm lanes against the round-20 HEAD. The
finding classes narrowed again: the retirement model had never learned the
gateway's own two labels, and the sweep's claims kept outrunning its edits.

## Fixed in this wave

1. **The gateway's transport relabel heals now** (lane C, med-high): a 502
   from the machine proxy answers with its own label plus the evidence in a
   separate field, which the client dropped. The error now carries the
   detail and the machine id; the wording table learned both labels; the
   claim heals on that machine's own answers instead of sitting red until a
   click.
2. **Background health failures are sequenced** (lane C): the single-machine
   health refresh now guards against stale arrivals like its runtime sibling,
   so a late failure cannot paint machine B's complaint onto machine A.
3. **The 1.5s hold window is back for auto-clears** (lane B): the reader's
   dismissal stays decisive; a poll-clear or expiry can no longer flash a
   banner away in 400ms.
4. **Page-claim semantics settled by the comments' own words** (lane B): any
   response from the origin disproves a page claim - the implementation was
   stricter than every comment describing it, and the comments were the
   stated design.
5. **The flags have one home** (lane C): the plugin API re-exports the wire
   contract from its defining module, the exports map carries a runtime
   condition (verified with a real runtime import), and docs/plugins.md
   states the one runtime export.
6. **Composed messages keep their machine's name** (lane C): the three
   unanchored wording rules now only shorten uncomposed claims; the composed
   prefix is recognisable by its own shape.
7. **The tile activity dot is out of the text column** (lane A): the padding
   formula reserves the dot's width, the shape the row variant already had.
8. **The bare clears are gone** (lane C): the workspace reset and three
   controller clears carry the retirement pair; the reset type now includes
   it, so a future bare write is a type error.
9. **Small truths** (lane A): the tree's selected/active markers use the
   shared rail token; the rail comments match their own edits; the stale
   "local" sentinel comments say "page".

## Adjudicated FALSE (recorded so nobody re-reports)

- **The guard's first-rule blind spot** (lanes A/C carried it forward): a
  crafted first-rule offence is caught at this HEAD - the round-18 fix held;
  the lanes re-tested against the pre-fix shape. The compound-selector
  pairing gap remains real but has no live instance (deferred).

## Deferred with written reason

- **The persistent-failure pulse** (carried): inherent to the model; the
  alternative is an owner decision.
- **knip cannot see test-only-used exports** (carried): tooling decision.
- **link.live** (carried): superseded this round - the dead proactive branch
  stays removed and the reactive model is the documented one.
