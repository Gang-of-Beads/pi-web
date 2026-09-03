# Reported problems

Owner-reported, in the order they were raised. Status is what can be shown, not
what was intended. "Shipped" means it is in a release; it does not mean the
owner has stopped seeing it, and where he still sees it that is recorded.

Nothing here is marked done on the strength of a passing test. The tests passed
for the duplicate row through ten separate fixes.

---

## Open — blocking daily use

### 1. One input renders as several rows, with the reply between the copies

Reported at least ten times. Six separate producers found so far, all of them
the same fault: the message's identity was re-derived by comparing text.

- Producers fixed and shipped in `1.202609.6`: text matching in queue
  correlation, attachment images looked up by text, empty text matching every
  other empty text, identity dropped by the compaction drain.
- Producers fixed **locally, not shipped**: ids swapped between the steer and
  follow-up lanes; a delivered prompt's record poisoning its successor.
- Root cause and design: `docs/design/one-message-one-row.md`. One register
  keyed by identity, so a second row cannot be constructed. **Written and wired
  locally, not shipped.**

**Still reproducible for the owner** on `1.202609.6`.

### 2. A sent message disappears

Sent with screenshots, then a refresh, and the message is gone. No error, no
trace, nothing to retry.

Root: between pressing send and the agent consuming it, a message exists only
in the browser's memory and the runtime's in-memory queue. Neither survives a
refresh or a daemon restart, and this session's daemon restarted three times in
one evening. A vanished message and a message never sent render identically.

Design written (`docs/design/one-message-one-row.md`, second half): a durable
outbox that holds a submitted message until the transcript claims it, and
reports it lost rather than dropping it.

**Not built.**

### 3. Goals will not load

The panel sits on "Loading goals…" and never resolves.

Root: the browser had **no request timeout anywhere**. A fetch that hangs never
resolves and never rejects, so the caller's `finally` never runs and every flag
it set stays set for the life of the page. The stuck loading states were
previously treated as ownership bugs and fixed one at a time; the flags were
owned correctly and the request never came back.

Fix in progress locally: every request settles, with a deadline; the four bare
`fetch` calls that bypassed the shared client got the same guard.

**Not shipped.**

### 4. The queued card jitters while a reply streams above it

Reported twice. Owner's description: streaming should push the content up
first, then render, so the card below does not shake.

Root: the bottom-edge correction runs in `requestAnimationFrame`, one frame
after the content grew. The browser paints the taller document first — with the
card pushed down — and the correction lands on the next frame. Two paints for
one change.

Fix in progress locally: hold the bottom edge synchronously in `updated()`,
before paint. An existing press-hold test caught the first attempt and is not
yet satisfied.

**Not shipped, not finished.**

### 5. Messages arrive out of order; "Queued" appears before the recovery

Reported, not yet investigated.

### 5b. "Sent", and then nothing: the session sits idle holding the message

The badge reads "Sent", which means only that the daemon's HTTP answer was a
success (`sessionController.ts:584` sets `received` when the POST returns). It
is not a claim that anything will happen next, and nothing did: the session
showed `idle` while the message sat there.

Proven race, `piSessionService.ts:2606` and `:2636`. Whether to queue is decided
from `session.isStreaming || session.isCompacting` at 2606; the resulting
`behavior` is handed to `submitPrompt` at 2636, and the decision is never
re-checked. If the turn ends between those two lines, `"followUp"` is handed to
a runtime that is now idle. The runtime parks it in its follow-up queue, and an
idle runtime has no turn-end to drain on.

What the user sees: a message marked Sent, a session marked idle, and no reply.
Inferred, not established: whether a later turn eventually drains it, which
would explain the companion report of a message consumed out of order long
after it was sent.

**The deeper fault is that "Sent" is a transport receipt being read as a
promise.** The message-sync design separates these: `accepted` says the daemon
has it, `queued`/`running` say what it is doing with it, and only the daemon may
assert those.

### 5c. "Queued" is shown two ways at once, and means four different things

On screen at the same time: a gold card reading "Queued to steer", and below it
a separate gold strip reading "1 queued" with a Clear queue button. Two visual
languages for one fact.

The strip exists only to give "Clear queue" a home - its own comment says so,
and says a panel would otherwise be "a second listing of the same text". The
count it carries is exactly that second listing: three queued messages are
already three gold cards.

Worse, the word "Queued" has four independent drivers that consult different
facts and disagree routinely: the gold border and Recall come from the daemon's
queue matched by id; the words "Queued to steer" come from a client-side
state machine; the row's placement comes from the register; the strip counts
the daemon's queue again. A card can be gold with no Recall, or sit in the
transcript still claiming to be queued.

**Design: one concept, one representation.** The queued message is the gold
card and says its own state, including its position in line. Clear queue
attaches to the last queued card rather than opening a second surface. Nothing
counts the queue twice, because the cards are the count.

### 6. Bare "core" appears as an assistant message

Not a PI WEB defect. It is stray output from the agent - a meaningless token
emitted before tool calls, repeatedly, through one session. It pollutes the
transcript the owner has to read and it is recorded here because he asked for
it to be, not because the application produced it.

**Cause: the agent. Fix: stop emitting it.**

---

## Open — not yet started

### 7. Quick access: switching session, then refreshing, loses the session

Lands on "Select or start a session."

### 8. Clay Paper selected but the interface renders dark

Suspected cause, unverified: `themes/index.ts` registers `clay-paper` as the
light half of a pair, and the system's dark-mode preference may override the
explicit choice. Needs reproducing in a browser before changing anything.

### 9. `.pi` is committed to the repository

24 tracked files, including `HANDOFF.md`, `TRACK.md`, four goal files and the
goal ledger. Needs a written rule for what belongs in the repository and what
is a runtime artifact.

### 10. Upstream identity still present

`pi-web.dev` remains in `CHANGELOG.md` (historical entries) and
`docs/index.html:172` (image alt text). Install instructions must all point at
`@gang-of-beads/pi-web`.

### 11. Rename uses the browser's native `prompt()`

`SessionList.ts`. Native dialogs can be suppressed in iOS standalone mode,
ignore the theme, and block rendering. The project has its own dialog
components. Pre-existing; changing it is a product decision.

---

## Carried over from the abandoned goals

Five goal records exist, and every task in all of them reads as incomplete -
including work that was demonstrably finished. The goal plugin stored its focus
in the session transcript, so compaction discarded it and nothing was ever
recorded against those goals again. Their task lists are therefore evidence of
what was *asked for*, not of what was done.

Checked against the code. These are the ones that are genuinely still open.

### 12. Confirm Goal Draft is unreachable while the queue has content

The last unfixed item of the oldest goal. Reported, never addressed.

### 13. Orphaned tool calls render as PENDING rather than interrupted

`ToolExecutionView.ts` mentions `interrupted`, so this may be partly done;
needs reproducing before it is called either way. **Not established.**

### 14. Agent runs show an Unknown status with no classification

Reported, never addressed.

### 15. The compacting label masks other activity

Reported as "fake done, ordering does not hold". Never addressed.

### 16. Receipts cannot be dismissed by hand

A `withdrawCommand` path was added for dialog receipts; whether it covers the
reported case is **not established**.

### 17. Desktop and phone are not consistent

The goal asked for a written list of every difference, each marked deliberate
or a defect. `docs/design/quick-access-and-parity.md` exists but does not
contain that enumeration. **Not done.**

### 18. Review kingo's PR #28 (workspace audio and video playback)

Asked for in two separate goals. The PR has **zero reviews**. Never done.

### 19. A queue-drain reconciliation: submitted messages still holding a queue row

The first task of the oldest goal, and the same family as items 1 and 5 above.
Covered by the message-sync design; listed here so the original request is not
lost.

### Verified as actually done, despite reading incomplete

- goal leaking across projects, boot-restore losing the session on refresh,
  compaction escape path, subagent failure notification design, the Anthropic
  palette, multi-model review, plugin presence as a three-state authority,
  merging #32/#33/#34, releasing and verifying provenance, upgrading three
  machines, removing the Appearance scale setting, and clearing the
  `.playwright-mcp` artifacts.
- The machine-tab and transient-session items were built and **withdrawn** on
  purpose; see "Decided and closed".

---

## Shipped in `1.202609.6`

Each of these was verified before release, and any that the owner can still
reproduce belongs in the open list above rather than here.

- Scrolling back through a long session no longer crawls or snaps back.
- A screenshot loading above the reader no longer carries the page down.
- "Loading this session…" clears when a selection is abandoned or replaced —
  but see item 3: the request behind it could still hang forever.
- The goal panel no longer renders another project's goal with live controls.
- Project tiles in a row share a height; long names no longer run under the
  actions button.
- The Goals drawer asks the runtime whether the plugin exists, instead of
  guessing from data.

---

## Decided and closed

- **Virtual scrolling** — measured, not needed. The transcript already pages at
  100 messages, the DOM holds under 300 rows, and walking all of them costs
  0.4ms. `content-visibility` made it slower.
- **Touch targets under 44px** — owner chose to keep the current density.
- **Image compression for the 413 error** — owner chose not to do it.
- **Machine tabs in quick access** — built, then withdrawn: it let you browse
  another machine's sessions but not open one.
- **"Still syncing this session"** — built, then withdrawn: `persisted: false`
  is the steady state of an empty session, so every new session would have said
  it forever, and the change removed the button that ends the state.

---

## For the owner

- `hxd-pi` had zero-length files in its nix store, on an SD card. Repaired for
  now; recurring build failures there are a hardware signal.
- The goal plugin's focus is stored in the session transcript, so compaction
  used to discard it. Fixed in `Gang-of-Beads/pi-goal` and installed, but a
  session already running keeps the code it started with.
