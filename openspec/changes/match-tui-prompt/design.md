## Context

See proposal.md - Why. What matters here is the shape of the code that has to
change.

The daemon builds an agent session through the SDK's own session services and
then adds to the result. Two additions are already known: a block appended to
every system prompt (`sessionEnvironmentFacts.ts`, surfacing as
`<pi_web_session_environment>`), and interception around unsupported extension
UI surfaces that answers on the model's behalf. Neither is declared anywhere, so
nobody can say today whether the list of additions is two long or twenty.

The native terminal host builds its session from the same SDK. That is what
makes equality testable rather than aspirational: both hosts can be asked to
construct a session over identical inputs and the results compared.

## Goals / Non-Goals

**Goals**

- One derived, code-level answer to "what does this host add", replacing a
  hand-maintained belief.
- Equality with the native host asserted by a test that fails on any difference,
  including differences introduced later by someone who has never read this.
- Every behaviour that the deleted prompt used to request is enforced in code
  before the prompt is deleted, not after.

**Non-Goals**

- Changing the SDK, or teaching the native host about the browser.
- Removing browser-side UI. Nothing here is about what the human sees.

## Decisions

### D1 - Compare constructed sessions, not strings we hope are the same

Build the agent session under both hosts over identical inputs in one test
process and compare the constructed system prompt, tool names, tool
descriptions, and message sequence. Rejected: snapshotting pi-web's prompt
alone, which proves only that it has not changed - it would have passed happily
every day this host has been adding to it.

### D2 - The enumeration is derived, not written

The list of host additions comes from the code path that builds the session: a
single seam through which every host contribution must pass, so that a
contribution added anywhere else is not merely undocumented but impossible.
Rejected: a markdown list of known deviations - the failure mode this whole
change exists to fix is exactly a list that stopped matching reality.

### D3 - Injected turns are typed, and the type is what makes them legal

Continuations, notifications and background reports become a closed set of
declared kinds. Anything else attempting to enter the conversation fails.
Rejected: allowing arbitrary injection and reviewing it by eye, which is how the
model came to be addressed by three different voices without any of them being
the user.

### D4 - Prompt-as-safeguard is converted before it is deleted

Each protection currently living in the environment block is classified as
either enforceable in code (then enforce it and test it), or a human concern
(then document it), or genuinely unnecessary (then say so and drop it). The
prompt text is removed only after its row is resolved. Rejected: deleting the
block first and dealing with the fallout, which trades a weak safeguard for
none.

### D5 - The comparison runs in the ordinary suite

The equality test is part of `npm run verify`, not a manual exercise. A
guarantee that only holds when someone remembers to check it is the same
guarantee this host has been giving its users all along.

## Risks / Trade-offs

- **The two hosts legitimately differ in ways that are not about the model**
  (transport, session persistence, where output is written) → compare only what
  reaches the model: prompt, tools, message sequence. Anything else is out of
  scope for the assertion and must be argued into it explicitly.
- **A protection exists only as prompt text and cannot be enforced in code**
  (for example, an agent choosing to restart the daemon that hosts it) → treat
  it as a guard at the point of action rather than as a rule in the prompt: the
  operation refuses, loudly, instead of being asked not to happen.
- **Removing host-added tools may remove capability the browser relied on** →
  the enumeration must list, for each tool, what depends on it; a capability the
  browser needs is served by the browser, not by handing the model a tool the
  terminal does not have.
- **The equality test is expensive to keep green** → that cost is the point. It
  is the only thing standing between this host and the drift it has already
  demonstrated.

## Migration Plan

1. Land the seam and the derived enumeration with the current additions still in
   place; the test records the deviations rather than failing, so the list is
   established from reality.
2. Resolve each row per D4 - enforce, document, or drop.
3. Flip the test to failing on any deviation once the list is empty.
4. Delete the dead prompt-construction code and its tests together.

Rollback: the seam is additive; if step 3 proves premature, the assertion can be
returned to recording mode without restoring the deleted prompt, since by then
its content lives in guards or documentation.

## Open Questions

None. The one decision that is the owner's - whether a host-added tool may
survive because the browser needs it - is resolved in the specs as no: the
browser serves its own needs, and the model gets the native tool set.
