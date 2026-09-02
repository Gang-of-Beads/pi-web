# Multi-model review of the September fixes: what was true

Three read-only reviews of `3892cb16..HEAD` (correctness, boundaries, tests) plus
a reconciling pass. Every finding below was checked against the code before it
was acted on; the reviewers' claims are not treated as evidence on their own.

Six defects were real, and all six were in work committed earlier the same
night. Two of them were introduced *by* the fixes they belonged to.

## Fixed

**1. The tool-result bound was applied where nothing reads it.** `700f38e6`…`8100aa55`

The measurement that motivated the bound came from a transcript page — 15.6 MB
for a hundred messages, five tool results being two thirds of it — and pages are
assembled straight from the stored branch, which the bound never touched. On the
live path the bounded field was `content`, which the client stores and never
displays; what it displays is `text`, which was unbounded, as was `details`.
The page still weighed exactly what it had before. All three are bounded now.

**2. Live dictation stacked its own reports.** `700f38e6`

Live dictation reports everything heard so far on every update; batch
transcription reports once. Both arrived through one callback that appended, so
"hello world" became "hello hello world" and grew with every interim result.
Invisible until now because the audio was framed as text, which the service
discards silently — no recognition event had ever reached the composer. The two
reporting styles are now separate callbacks so the type system refuses to
confuse them.

**3. The transcript loading flag had no scope.** `8a240f91`

A bare boolean cleared by whichever selection reached its `finally` last, while
every other guard in the same function keys on the selection counter. Selecting
a second session while the first was in flight let the first clear the second's
flag — and the view then called a still-loading session empty and offered to
write its first message. That is the defect the flag was added to prevent,
reappearing through the flag itself.

**4. A command answered by a dialog left a stuck receipt.** `8cad538c`

Reporting what a command did, rather than whether the request reached the
server, left `select` and `tree` with no outcome to report. Their rows stayed
pending — and a pending row is deliberately undismissable and exempt from the
ledger cap — so every dialog opened added a permanent line. The row is now
withdrawn when a dialog opens; dismissal keeps refusing pending rows, because a
receipt still waiting for its outcome must not be sweepable.

**5. Stopping dictation never declared the end of speech.** `167fe021`

An empty audio chunk is how the protocol says the utterance is over — the
encoder's own docstring said so — and `stop()` closed the socket without sending
one. The tail of a sentence survived only if the service's silence detection had
already fired. Verified by removing the send again: the test goes red.

**6. A test asserted something that could not fail.** `ba3f0278`

The waiting-card test queried for an inline style the component never writes, so
it passed whatever the card did, including against the code it was meant to
guard. It now reads the stylesheet; putting `sticky` back into the rule turns it
red, which was checked. Its file header still described an intermediate design
that contradicted the assertion below it.

## Fixed as documentation

**7. Comments and a design doc still stated a deleted rule.** `ba3f0278`

Two comments in `messageDelivery.ts` — one orphaned above no function at all —
and one line of `docs/message-delivery-design.md` still said absence from the
queue proves delivery. That inference was removed precisely because a snapshot
omits a message while the agent expands it, between taking it and writing it,
and when its id could not be stamped at all. The queue can raise a message to
*queued* and never to *delivered*.

## Not fixed, deliberately

**8. The audio format is agreed by accident.** `d3f29e76`

The frame header names `audio/x-wav`, which normally carries a RIFF header,
while the payload is headerless PCM. It works because the service's default
input format equals what the capture path resamples to, and because
`speech.config` declares no format. Declaring it explicitly is a protocol change
with more risk than value against a path that is now verified working. The
coupling is written down where the header is built and pinned by tests, so
changing the sample rate or width fails there rather than becoming silence in
the composer.

## Not established

**The claim that `abortSessionOperations` needed the runtime's own contract
re-checked.** The fake in its test mirrors the three methods the runtime
exposes; that the runtime keeps exposing them is a dependency fact, not
something this suite can assert. Left as is.

**Whether the reported subagent runs were refused by the ownership gate or never
reached it.** `status.json` records no delivery attempt, so disk cannot answer
it. Recorded in the subagent design note as an open question rather than
asserted either way.

## What this says about the batch

The reviews found nothing wrong with the five fixes' *diagnoses* — every root
cause named in those commits held up. What they found is that two fixes did not
reach the path they were aimed at, and two created new stuck states while
removing dishonest ones. Both failure modes share a shape: the fix was verified
against the mechanism it changed rather than against the symptom the owner
reported.
